import { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Lead, Message } from '../entities';
import { LeadsService } from '../leads/leads.service';
import { ConversationMessage } from './extraction/prompts';
import { PropertyQuery } from './agent/property-query';

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
