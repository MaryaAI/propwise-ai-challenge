import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, OptionalProps, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { Agent } from '../../entities/agent.entity';
import { Task } from '../../entities/task.entity';
import { AssistantRun } from './assistant-run.entity';

export const ASSISTANT_ACTION_TYPES = ['create_follow_up_task'] as const;
export type AssistantActionType = (typeof ASSISTANT_ACTION_TYPES)[number];

export const ASSISTANT_ACTION_STATUSES = ['pending_approval', 'approved', 'rejected'] as const;
export type AssistantActionStatus = (typeof ASSISTANT_ACTION_STATUSES)[number];

/** A follow-up task proposed by an assistant run. Nothing is saved until Sara approves it. */
@Entity({ tableName: 'assistant_actions' })
@Index({ properties: ['run'] })
export class AssistantAction {
  [OptionalProps]?: 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne({ entity: () => AssistantRun })
  run!: AssistantRun;

  @Enum({ items: [...ASSISTANT_ACTION_TYPES] })
  type!: AssistantActionType;

  @Enum({ items: [...ASSISTANT_ACTION_STATUSES] })
  status: AssistantActionStatus = 'pending_approval';

  @Property({ type: 'string' })
  title!: string;

  @Property({ type: 'text', nullable: true })
  notes?: string | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  dueAt?: Date | null;

  @Property({ type: 'text', nullable: true })
  needsClarification?: string | null;

  @ManyToOne({ entity: () => Task, nullable: true })
  @Unique()
  task?: Task | null;

  @Property({ type: 'datetime', columnType: 'timestamptz', nullable: true })
  decidedAt?: Date | null;

  @ManyToOne({ entity: () => Agent, nullable: true })
  decidedBy?: Agent | null;
}
