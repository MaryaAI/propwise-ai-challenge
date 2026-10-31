import { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { AssistantRun, Lead, Message } from '../entities';
import { LeadsService } from '../leads/leads.service';
import { ConversationMessage } from './extraction/prompts';
import { PropertyQuery } from './agent/property-query';
import { parseRequirementsState } from './policy/merge';
import { RequirementsState } from './types';

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
  parentState: RequirementsState | null;
  parentRecommendations: RecommendationCarry[];
  /** Oldest first, capped at CHAT_HISTORY_TURNS. */
  history: ChatTurn[];
}

/** A parent recommendation, reduced to what the guardrails need to re-verify it. */
export interface RecommendationCarry {
  propertyId: string;
  reason: string;
}

const CHAT_HISTORY_TURNS = 6;

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

  const extraction = parentRun.extraction as { state?: unknown } | null;
  const parentState = parseRequirementsState(extraction?.state);
  const parentRecommendations = parseRecommendationCarry(parentRun.recommendations);

  // Walked explicitly rather than via populate: `parentRun` is a plain reference, so reading
  // `.agentMessage` off an uninitialised one yields undefined WITHOUT throwing -- a naive walk
  // would silently produce empty turns. Bounded to CHAT_HISTORY_TURNS hops, agency-scoped.
  const history: ChatTurn[] = [];
  let cursor: AssistantRun | null = parentRun;
  for (let hop = 0; hop < CHAT_HISTORY_TURNS && cursor !== null; hop++) {
    if (cursor.agentMessage) history.push({ agentMessage: cursor.agentMessage, reply: cursor.reply });
    const parentId: string | undefined = cursor.parentRun?.id;
    cursor = parentId ? await em.findOne(AssistantRun, { id: parentId, lead: lead.id, agency: agencyId }) : null;
  }
  history.reverse();

  const areas = await propertyQuery.distinctAreas(agencyId);

  return { lead, message, conversation, areas, parentRun, parentState, parentRecommendations, history };
}
