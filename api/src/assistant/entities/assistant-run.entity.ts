import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, OptionalProps } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { Agency } from '../../entities/agency.entity';
import { Agent } from '../../entities/agent.entity';
import { Lead } from '../../entities/lead.entity';
import { Message } from '../../entities/message.entity';

export const ASSISTANT_RUN_TRIGGERS = ['analysis', 'chat'] as const;
export type AssistantRunTrigger = (typeof ASSISTANT_RUN_TRIGGERS)[number];

export const ASSISTANT_RUN_STATUSES = ['completed', 'failed'] as const;
export type AssistantRunStatus = (typeof ASSISTANT_RUN_STATUSES)[number];

/** One analysis of a lead's message (or a chat follow-up), with its tool trace and proposed actions. */
@Entity({ tableName: 'assistant_runs' })
@Index({ properties: ['lead', 'createdAt'] })
export class AssistantRun {
  [OptionalProps]?: 'createdAt' | 'trigger' | 'summary' | 'reply';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne({ entity: () => Agency })
  agency!: Agency;

  @ManyToOne({ entity: () => Lead })
  lead!: Lead;

  @ManyToOne({ entity: () => Message })
  message!: Message;

  @ManyToOne({ entity: () => Agent })
  createdBy!: Agent;

  @Property({ type: 'datetime', columnType: 'timestamptz' })
  createdAt: Date = new Date();

  @ManyToOne({ entity: () => AssistantRun, nullable: true })
  parentRun?: AssistantRun | null;

  @Property({ type: 'text', nullable: true })
  agentMessage?: string | null;

  @Enum({ items: [...ASSISTANT_RUN_TRIGGERS] })
  trigger: AssistantRunTrigger = 'analysis';

  @Enum({ items: [...ASSISTANT_RUN_STATUSES] })
  status!: AssistantRunStatus;

  @Property({ type: 'text', nullable: true })
  error?: string | null;

  @Property({ type: 'text' })
  summary: string = '';

  @Property({ type: 'text' })
  reply: string = '';

  @Property({ type: 'json' })
  requirements!: unknown;

  @Property({ type: 'json' })
  extraction!: unknown;

  @Property({ type: 'json' })
  recommendations!: unknown;

  @Property({ type: 'json' })
  trace!: unknown;

  @Property({ type: 'json' })
  steps!: unknown;
}
