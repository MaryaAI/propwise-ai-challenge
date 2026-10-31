import { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AssistantRun, Lead, Message } from '../entities';
import { LeadsService } from '../leads/leads.service';
import { ConversationMessage } from './extraction/prompts';
import { PropertyQuery } from './agent/property-query';
import { parseRequirementsState } from './policy/merge';
import { RequirementsState, ResolvedTiming } from './types';

const CONVERSATION_WINDOW = 10;

export interface RunContext {
  lead: Lead;
  message: Message;
  conversation: ConversationMessage[];
  areas: string[];
}

function toConversationMessage(message: Message): ConversationMessage {
  return {
    id: message.id,
    direction: message.direction,
    sentAt: message.sentAt.toISOString(),
    body: message.body,
  };
}

export async function loadRunContext(options: {
  em: EntityManager;
  leadsService: LeadsService;
  propertyQuery: PropertyQuery;
  agencyId: string;
  leadId: string;
  messageId?: string;
}): Promise<RunContext> {
  const { em, leadsService, propertyQuery, agencyId, leadId, messageId } = options;

  const lead = await leadsService.findLead(agencyId, leadId);

  // Checked unconditionally, before resolving a specific messageId, per TASK.md's "whether messageId was given or not".
  const inboundCount = await em.count(Message, { lead, direction: 'inbound' });
  if (inboundCount === 0) {
    throw new UnprocessableEntityException('This lead has no inbound message yet.');
  }

  let message: Message | null;
  if (messageId !== undefined) {
    message = await em.findOne(Message, { id: messageId, lead });
    if (!message) throw new NotFoundException('Message not found');
  } else {
    message = await em.findOne(Message, { lead, direction: 'inbound' }, { orderBy: { sentAt: 'desc', id: 'desc' } });
  }
  if (!message) throw new NotFoundException('Message not found');

  const allMessages = await em.find(Message, { lead }, { orderBy: { sentAt: 'asc', id: 'asc' } });
  const analysedIndex = allMessages.findIndex((m) => m.id === message!.id);
  const windowStart = Math.max(0, analysedIndex - CONVERSATION_WINDOW + 1);
  const conversation = allMessages.slice(windowStart, analysedIndex + 1).map(toConversationMessage);

  const areas = await propertyQuery.distinctAreas(agencyId);

  return { lead, message, conversation, areas };
}

/** One prior chat turn: what the agent asked and what the assistant replied. */
export interface ChatTurn {
  agentMessage: string;
  reply: string;
}

export interface ChatContext extends RunContext {
  parentRun: AssistantRun;
  /** From the nearest completed ancestor, so a failed run in between does not erase it. */
  parentState: RequirementsState | null;
  parentRecommendations: RecommendationCarry[];
  /** The follow-up date already resolved upstream, inherited when this turn states no timing. */
  parentTiming: ResolvedTiming | null;
  /** Oldest first, capped at CHAT_HISTORY_TURNS. */
  history: ChatTurn[];
}

/** A parent recommendation, reduced to what the guardrails need to re-verify it. */
export interface RecommendationCarry {
  propertyId: string;
  reason: string;
}

const CHAT_HISTORY_TURNS = 6;

function parseResolvedTiming(value: unknown): ResolvedTiming | null {
  if (typeof value !== 'object' || value === null) return null;
  const { dueAt, needsClarification } = value as { dueAt?: unknown; needsClarification?: unknown };
  const okDueAt = typeof dueAt === 'string' || dueAt === null;
  const okReason = typeof needsClarification === 'string' || needsClarification === null;
  if (!okDueAt || !okReason) return null;
  return { dueAt: dueAt as string | null, needsClarification: needsClarification as string | null };
}

function parseRecommendationCarry(value: unknown): RecommendationCarry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const { propertyId, reason } = item as { propertyId?: unknown; reason?: unknown };
    if (typeof propertyId !== 'string') return [];
    return [{ propertyId, reason: typeof reason === 'string' ? reason : '' }];
  });
}

export async function loadChatContext(options: {
  em: EntityManager;
  leadsService: LeadsService;
  propertyQuery: PropertyQuery;
  agencyId: string;
  leadId: string;
  runId: string;
}): Promise<ChatContext> {
  const { em, leadsService, propertyQuery, agencyId, leadId, runId } = options;

  const lead = await leadsService.findLead(agencyId, leadId);

  // Scoped on all three, so another agency's run -- or this agency's run under the wrong lead id --
  // is a 404 rather than a leak, matching getRun and architecture section 6.
  const parentRun = await em.findOne(AssistantRun, { id: runId, lead: lead.id, agency: agencyId }, { populate: ['message'] });
  if (!parentRun) throw new NotFoundException('Run not found');

  // A chat turn creates no Message row, so it reuses the parent's analysed message. That keeps the
  // contract's messageId honest and means a chat turn never writes to the lead's conversation.
  const message = parentRun.message;

  const allMessages = await em.find(Message, { lead }, { orderBy: { sentAt: 'asc', id: 'asc' } });
  const analysedIndex = allMessages.findIndex((m) => m.id === message.id);
  const windowStart = Math.max(0, analysedIndex - CONVERSATION_WINDOW + 1);
  const conversation = allMessages.slice(windowStart, analysedIndex + 1).map(toConversationMessage);

  // Walked explicitly rather than via populate: `parentRun` is a plain reference, so reading
  // `.agentMessage` off an uninitialised one yields undefined WITHOUT throwing -- a naive walk
  // would silently produce empty turns. Bounded to CHAT_HISTORY_TURNS hops, agency-scoped.
  //
  // The walk also recovers the last usable state/shortlist/timing. A failed run persists none of
  // those (empty requirements, no `extraction.state`, recommendations []), so reading only the
  // immediate parent would collapse the requirements after any transient model failure -- and
  // because the guardrails skip the area/bedrooms/type checks when those fields are null, a
  // retry on a failed run could then accept a listing that matches nothing the lead asked for.
  const history: ChatTurn[] = [];
  let parentState: RequirementsState | null = null;
  let parentRecommendations: RecommendationCarry[] = [];
  let parentTiming: ResolvedTiming | null = null;
  let recoveredFrom: AssistantRun | null = null;

  let cursor: AssistantRun | null = parentRun;
  for (let hop = 0; hop < CHAT_HISTORY_TURNS && cursor !== null; hop++) {
    if (cursor.agentMessage) history.push({ agentMessage: cursor.agentMessage, reply: cursor.reply });

    if (recoveredFrom === null) {
      const extraction = cursor.extraction as { state?: unknown; timing?: unknown } | null;
      const state = parseRequirementsState(extraction?.state);
      // A completed run with parseable state is authoritative, even if its state is empty (a
      // "clarify" run legitimately has one). Only a failed or pre-`state` run falls through.
      if (state !== null && cursor.status === 'completed') {
        parentState = state;
        parentRecommendations = parseRecommendationCarry(cursor.recommendations);
        parentTiming = parseResolvedTiming(extraction?.timing);
        recoveredFrom = cursor;
      }
    }

    const parentId: string | undefined = cursor.parentRun?.id;
    cursor = parentId ? await em.findOne(AssistantRun, { id: parentId, lead: lead.id, agency: agencyId }) : null;
  }
  history.reverse();

  const areas = await propertyQuery.distinctAreas(agencyId);

  return { lead, message, conversation, areas, parentRun, parentState, parentRecommendations, parentTiming, history };
}
