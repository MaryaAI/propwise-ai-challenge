import { DateTime } from 'luxon';
import { toTaskDto } from '../common/dto';
import { AssistantAction, AssistantRun, Task } from '../entities';

export function toProposedActionDto(action: AssistantAction, agentTimezone: string) {
  const dueAt = action.dueAt
    ? DateTime.fromJSDate(action.dueAt, { zone: 'utc' }).setZone(agentTimezone).toISO({ suppressMilliseconds: true })
    : null;
  return {
    id: action.id,
    type: action.type,
    status: action.status,
    task: { title: action.title, notes: action.notes ?? null, dueAt },
    needsClarification: action.needsClarification ?? null,
  };
}

export function toAssistantRunDto(run: AssistantRun, actions: AssistantAction[], agentTimezone: string) {
  return {
    id: run.id,
    leadId: run.lead.id,
    messageId: run.message.id,
    status: run.status,
    error: run.error ?? undefined,
    requirements: run.requirements,
    recommendations: run.recommendations,
    summary: run.summary,
    proposedActions: actions.map((action) => toProposedActionDto(action, agentTimezone)),
    trace: run.trace,
    createdAt: run.createdAt.toISOString(),

    parentRunId: run.parentRun?.id ?? null,
    trigger: run.trigger,
    agentMessage: run.agentMessage ?? null,
    reply: run.reply,
    extraction: run.extraction,
    steps: run.steps,
  };
}

export function toApproveResponseDto(action: AssistantAction, task: Task, agentTimezone: string) {
  return { action: toProposedActionDto(action, agentTimezone), task: toTaskDto(task) };
}

export function toRejectResponseDto(action: AssistantAction, agentTimezone: string) {
  return { action: toProposedActionDto(action, agentTimezone) };
}
