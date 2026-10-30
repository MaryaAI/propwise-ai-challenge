import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { Agency, Agent, AssistantAction, AssistantRun, Lead, Message } from '../entities';
import { LeadsService } from '../leads/leads.service';
import { PropertyQuery } from './agent/property-query';
import { AgentFailedError, AgentRunner } from './agent/agent-runner';
import { Trace } from './agent/tracing';
import { loadRunContext } from './context';
import { ExtractionFailedError, Extractor } from './extraction/extractor';
import { computeDueAt } from './policy/follow-up-date';
import { bedroomsRange, mergeRequirements, toContractRequirements } from './policy/merge';
import { filterRecommendations, grossYield, selectRecommendations } from './policy/guardrails';
import { route } from './policy/router';
import { clarifyTemplate, closedTemplate, rentTemplate, TemplateOutput } from './policy/templates';
import { Candidate, ContractRequirements, PropertyFacts, RequirementsState, Route } from './types';

const RUN_TIMEOUT_MS = 100_000;

interface RecommendationSnapshot {
  propertyId: string;
  reason: string;
  property: {
    reference: string;
    title: string;
    area: string;
    bedrooms: number;
    priceAed: number;
    annualRentAed: number | null;
    grossYield: number | null;
    status: string;
  };
}

function emptyContractRequirements(): ContractRequirements {
  return { locations: [], bedrooms: null, budgetAed: { min: null, max: null }, propertyType: null, intent: 'unknown', preferences: [] };
}

function collectSeenPropertyIds(entries: ReturnType<Trace['toContract']>): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.error !== undefined) continue;
    if (entry.tool === 'search_properties') {
      const output = entry.output as { items: { id: string }[] } | null;
      output?.items.forEach((item) => ids.add(item.id));
    } else if (entry.tool === 'get_property') {
      const output = entry.output as { found: boolean; property?: { id: string } } | null;
      if (output?.found && output.property) ids.add(output.property.id);
    }
  }
  return ids;
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly em: EntityManager,
    private readonly leadsService: LeadsService,
    private readonly propertyQuery: PropertyQuery,
    private readonly extractor: Extractor,
    private readonly agentRunner: AgentRunner,
  ) {}

  async run(
    input: { agencyId: string; agentId: string; leadId: string; messageId?: string },
  ): Promise<{ run: AssistantRun; actions: AssistantAction[]; agentTimezone: string }> {
    const agent = await this.em.findOneOrFail(Agent, input.agentId, { populate: ['agency'] });

    const context = await loadRunContext({
      em: this.em,
      leadsService: this.leadsService,
      propertyQuery: this.propertyQuery,
      agencyId: input.agencyId,
      leadId: input.leadId,
      messageId: input.messageId,
    });

    const abortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS);

    let persisted: { run: AssistantRun; actions: AssistantAction[] };
    try {
      const outcome = await this.analyse(input.agencyId, agent, context, abortSignal);
      persisted = await this.persist({
        agencyId: input.agencyId,
        agentId: agent.id,
        leadId: input.leadId,
        messageId: context.message.id,
        status: 'completed',
        ...outcome,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const trace = error instanceof Error ? (error as Error & { trace?: Trace }).trace : undefined;
      persisted = await this.persist({
        agencyId: input.agencyId,
        agentId: agent.id,
        leadId: input.leadId,
        messageId: context.message.id,
        status: 'failed',
        error: message,
        requirements: emptyContractRequirements(),
        recommendations: [],
        summary: '',
        reply: '',
        proposedAction: null,
        trace: trace ? trace.toContract() : [],
      });
    }
    return { ...persisted, agentTimezone: agent.timezone };
  }

  async getRun(agencyId: string, leadId: string, runId: string): Promise<{ run: AssistantRun; actions: AssistantAction[] } | null> {
    const run = await this.em.findOne(
      AssistantRun,
      { id: runId, lead: leadId, agency: agencyId },
      { populate: ['lead', 'message', 'createdBy'] },
    );
    if (!run) return null;
    const actions = await this.em.find(AssistantAction, { run });
    return { run, actions };
  }

  private async analyse(agencyId: string, agent: Agent, context: Awaited<ReturnType<typeof loadRunContext>>, abortSignal: AbortSignal) {
    const extraction = await this.extractor.extract({
      agencyName: agent.agency.name,
      areas: context.areas,
      conversation: context.conversation,
      analysedMessageId: context.message.id,
      abortSignal,
    });

    const merged: RequirementsState = mergeRequirements(null, extraction.update);
    const chosenRoute = route({ trigger: 'analysis', intent: extraction.intent, closed: extraction.closed, state: merged });
    const requirements = toContractRequirements(merged);

    let summary: string;
    let reply: string;
    let recommendations: RecommendationSnapshot[] = [];
    let followUpTask: { title: string; notes: string | null } | null;
    let trace: ReturnType<Trace['toContract']> = [];

    if (chosenRoute === 'search') {
      const agentResult = await this.agentRunner.run({
        agencyId,
        agencyName: agent.agency.name,
        agentName: agent.name,
        requirements,
        abortSignal,
      });
      trace = agentResult.trace.toContract();
      summary = agentResult.output.summary;
      reply = agentResult.output.reply;
      followUpTask = agentResult.output.followUpTask;
      recommendations = await this.buildRecommendationSnapshots(agencyId, agentResult.output.recommendations, merged, agentResult.trace);
    } else {
      const template = this.templateFor(chosenRoute, context.lead.name);
      summary = template.summary;
      reply = template.reply;
      followUpTask = template.followUpTask;
    }

    const { dueAt, needsClarification } = computeDueAt(extraction.followUp, context.message.sentAt, agent.timezone);

    return {
      requirements,
      recommendations,
      summary,
      reply,
      proposedAction: followUpTask ? { title: followUpTask.title, notes: followUpTask.notes, dueAt, needsClarification } : null,
      trace,
      extraction: { bedroomsRange: bedroomsRange(merged), rejected: extraction.rejected, propertyRefs: extraction.propertyRefs },
    };
  }

  private templateFor(chosenRoute: Exclude<Route, 'search'>, leadName: string): TemplateOutput {
    switch (chosenRoute) {
      case 'rent':
        return rentTemplate(leadName);
      case 'clarify':
        return clarifyTemplate(leadName);
      case 'closed':
        return closedTemplate(leadName);
      case 'property_question':
      case 'change_follow_up':
        // Chat-only routes (architecture section 2): unreachable with trigger: 'analysis'.
        throw new Error(`Route "${chosenRoute}" requires a chat trigger, not supported yet.`);
    }
  }

  private async buildRecommendationSnapshots(
    agencyId: string,
    candidates: Candidate[],
    requirements: RequirementsState,
    trace: Trace,
  ): Promise<RecommendationSnapshot[]> {
    const seenIds = collectSeenPropertyIds(trace.toContract());
    const facts = await this.propertyQuery.factsByIds(agencyId, candidates.map((c) => c.propertyId));

    const { accepted } = filterRecommendations({ candidates, facts, agencyId, requirements, seenIds });
    const preferences = requirements.preferences.map((p) => p.value);
    const selected = selectRecommendations({ accepted, facts, preferences });

    return selected.map((candidate) => {
      const fact = facts.get(candidate.propertyId) as PropertyFacts;
      return {
        propertyId: candidate.propertyId,
        reason: candidate.reason,
        property: {
          reference: fact.reference,
          title: fact.title,
          area: fact.area,
          bedrooms: fact.bedrooms,
          priceAed: fact.priceAed,
          annualRentAed: fact.annualRentAed,
          grossYield: grossYield(fact),
          status: fact.status,
        },
      };
    });
  }

  private async persist(data: {
    agencyId: string;
    agentId: string;
    leadId: string;
    messageId: string;
    status: 'completed' | 'failed';
    error?: string;
    requirements: ContractRequirements;
    recommendations: RecommendationSnapshot[];
    summary: string;
    reply: string;
    proposedAction: { title: string; notes: string | null; dueAt: string | null; needsClarification: string | null } | null;
    trace: ReturnType<Trace['toContract']>;
    extraction?: { bedroomsRange: { min: number; max: number } | null; rejected: unknown; propertyRefs: string[] };
  }): Promise<{ run: AssistantRun; actions: AssistantAction[] }> {
    const fork = this.em.fork();

    const run = fork.create(AssistantRun, {
      agency: fork.getReference(Agency, data.agencyId),
      lead: fork.getReference(Lead, data.leadId),
      message: fork.getReference(Message, data.messageId),
      createdBy: fork.getReference(Agent, data.agentId),
      trigger: 'analysis',
      status: data.status,
      error: data.error ?? null,
      summary: data.summary,
      reply: data.reply,
      requirements: data.requirements,
      extraction: data.extraction ?? { bedroomsRange: null, rejected: [], propertyRefs: [] },
      recommendations: data.recommendations,
      trace: data.trace,
      steps: [],
    });

    const actions: AssistantAction[] = [];
    if (data.proposedAction) {
      actions.push(
        fork.create(AssistantAction, {
          run,
          type: 'create_follow_up_task',
          title: data.proposedAction.title,
          notes: data.proposedAction.notes,
          dueAt: data.proposedAction.dueAt ? new Date(data.proposedAction.dueAt) : null,
          needsClarification: data.proposedAction.needsClarification,
        }),
      );
    }

    await fork.flush();
    return { run, actions };
  }
}
