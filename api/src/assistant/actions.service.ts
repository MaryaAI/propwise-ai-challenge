import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Agency, Agent, AssistantAction, Lead, Task } from '../entities';
import { toApproveResponseDto, toRejectResponseDto } from './assistant.mapper';

@Injectable()
export class ActionsService {
  constructor(private readonly em: EntityManager) {}

  async approve(agencyId: string, leadId: string, runId: string, actionId: string, decidedById: string) {
    const { action, agentTimezone } = await this.findOwnedAction(agencyId, leadId, runId, actionId);

    const result = await this.em.transactional(async (tx) => {
      const locked = await tx.findOneOrFail(AssistantAction, { id: action.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });

      if (locked.status === 'rejected') throw new ConflictException('This action was already rejected');
      if (locked.status === 'approved') {
        const existingTask = await tx.findOneOrFail(Task, { id: locked.task!.id }, { populate: ['createdBy'] });
        return { action: locked, task: existingTask };
      }

      const task = tx.create(Task, {
        agency: tx.getReference(Agency, agencyId),
        lead: tx.getReference(Lead, leadId),
        title: locked.title,
        notes: locked.notes ?? null,
        dueAt: locked.dueAt ?? null,
        status: 'open',
        createdBy: tx.getReference(Agent, decidedById),
      });
      locked.status = 'approved';
      locked.task = task;
      locked.decidedAt = new Date();
      locked.decidedBy = tx.getReference(Agent, decidedById);

      return { action: locked, task };
    });

    await this.em.populate(result.task, ['createdBy']);
    return toApproveResponseDto(result.action, result.task, agentTimezone);
  }

  async reject(agencyId: string, leadId: string, runId: string, actionId: string, decidedById: string) {
    const { action, agentTimezone } = await this.findOwnedAction(agencyId, leadId, runId, actionId);

    const decided = await this.em.transactional(async (tx) => {
      const locked = await tx.findOneOrFail(AssistantAction, { id: action.id }, { lockMode: LockMode.PESSIMISTIC_WRITE });

      if (locked.status === 'approved') throw new ConflictException('This action was already approved');
      if (locked.status === 'rejected') return locked;

      locked.status = 'rejected';
      locked.decidedAt = new Date();
      locked.decidedBy = tx.getReference(Agent, decidedById);
      return locked;
    });

    return toRejectResponseDto(decided, agentTimezone);
  }

  private async findOwnedAction(agencyId: string, leadId: string, runId: string, actionId: string) {
    const action = await this.em.findOne(
      AssistantAction,
      { id: actionId, run: { id: runId, lead: leadId, agency: agencyId } },
      { populate: ['run.createdBy'] },
    );
    if (!action) throw new NotFoundException('Action not found');
    return { action, agentTimezone: action.run.createdBy.timezone };
  }
}
