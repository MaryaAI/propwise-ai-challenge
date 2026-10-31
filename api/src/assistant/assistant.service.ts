import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Agency, Agent, AssistantAction, AssistantRun, Lead, Message } from '../entities';
import { AssistantRunTrigger } from './entities/assistant-run.entity';
import { LeadsService } from '../leads/leads.service';
import { PropertyQuery } from './agent/property-query';
import { AgentFailedError, AgentRunner } from './agent/agent-runner';
import { Trace } from './agent/tracing';
import { ChatTurn, loadChatContext, loadRunContext, RecommendationCarry, RunContext } from './context';
import { ExtractionFailedError, Extractor } from './extraction/extractor';
import { AGENT_INSTRUCTION_SOURCE_ID, ConversationMessage } from './extraction/prompts';
import { computeDueAt } from './policy/follow-up-date';
import { bedroomsRange, emptyRequirementsState, mergeRequirements, toAgentBrief, toContractRequirements } from './policy/merge';
import { effectiveMaxAed, filterRecommendations, grossYield, selectRecommendations } from './policy/guardrails';
import { route } from './policy/router';
import { changeFollowUpTemplate, clarifyTemplate, closedTemplate, followUpTitle, rentTemplate, TemplateOutput } from './policy/templates';
import { Candidate, ContractRequirements, FollowUpTiming, PropertyFacts, RequirementsState, ResolvedTiming, Route } from './types';

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

type RejectedRecommendation = { propertyId: string; why: string };

/**
 * Records that the lead's wording widened the price ceiling, when it did. Without this, a
 * recommendation priced above the `budgetAed.max` in the same response looks like an arithmetic
 * error rather than the deliberate 5% tolerance on "around".
 */
function budgetToleranceStep(state: RequirementsState) {
  const budget = state.budget?.value ?? null;
  const effective = effectiveMaxAed(budget);
  if (budget === null || budget.maxAed === null || effective === null || effective === budget.maxAed) return [];
  return [
    {
      step: 'budget_tolerance' as const,
      qualifier: budget.qualifier,
      statedMaxAed: budget.maxAed,
      effectiveMaxAed: effective,
    },
  ];
}

function emptyContractRequirements(): ContractRequirements {
  return { locations: [], bedrooms: null, budgetAed: { min: null, max: null }, propertyType: null, intent: 'unknown', preferences: [] };
}

/**
 * Which routes propose a follow-up task, per architecture section 2's route table. `closed` needs
 * no follow-up, and `property_question` carries the parent's pending action forward rather than
 * proposing a second one (an action is reachable only under its own run's URL, so duplicating it
 * would let the same follow-up be approved twice into two separate tasks).
 */
function proposesFollowUp(chosenRoute: Route): boolean {
  return chosenRoute !== 'closed' && chosenRoute !== 'property_question';
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

  /**
   * A follow-up turn on an existing run. Creates a NEW run with `parentRun` set and
   * `trigger: 'chat'` (architecture section 6) -- the parent row is never updated.
   */
  async chat(
    input: { agencyId: string; agentId: string; leadId: string; runId: string; content: string },
  ): Promise<{ run: AssistantRun; actions: AssistantAction[]; agentTimezone: string }> {
    const agent = await this.em.findOneOrFail(Agent, input.agentId, { populate: ['agency'] });

    const context = await loadChatContext({
      em: this.em,
      leadsService: this.leadsService,
      propertyQuery: this.propertyQuery,
      agencyId: input.agencyId,
      leadId: input.leadId,
      runId: input.runId,
    });

    const abortSignal = AbortSignal.timeout(RUN_TIMEOUT_MS);
    const common = {
      agencyId: input.agencyId,
      agentId: agent.id,
      leadId: input.leadId,
      messageId: context.message.id,
      trigger: 'chat' as const,
      parentRunId: context.parentRun.id,
      agentMessage: input.content,
    };

    let persisted: { run: AssistantRun; actions: AssistantAction[] };
    try {
      const outcome = await this.analyse(input.agencyId, agent, context, abortSignal, {
        instruction: input.content,
        parentState: context.parentState,
        parentRecommendations: context.parentRecommendations,
        parentTiming: context.parentTiming,
        history: context.history,
      });
      persisted = await this.persist({ ...common, status: 'completed', ...outcome });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const trace = error instanceof Error ? (error as Error & { trace?: Trace }).trace : undefined;
      persisted = await this.persist({
        ...common,
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

  /** Newest first. Additive endpoint (architecture section 6), so the UI can load the latest run. */
  async listRuns(
    agencyId: string,
    leadId: string,
    limit?: number,
  ): Promise<{ items: { run: AssistantRun; actions: AssistantAction[] }[]; total: number }> {
    const lead = await this.leadsService.findLead(agencyId, leadId);

    const [runs, total] = await this.em.findAndCount(
      AssistantRun,
      { lead: lead.id, agency: agencyId },
      // `createdBy` is required: the mapper reads its timezone, and an undefined one would make
      // luxon silently fall back to the process zone, so every dueAt offset would be wrong.
      { populate: ['lead', 'message', 'createdBy'], orderBy: { createdAt: 'desc', id: 'desc' }, limit: limit ?? 20 },
    );

    // One query for every run's actions rather than one per run.
    const actionsByRun = new Map<string, AssistantAction[]>();
    if (runs.length > 0) {
      const actions = await this.em.find(AssistantAction, { run: { $in: runs.map((r) => r.id) } });
      for (const action of actions) {
        const bucket = actionsByRun.get(action.run.id) ?? [];
        bucket.push(action);
        actionsByRun.set(action.run.id, bucket);
      }
    }

    // No single agentTimezone: each run is mapped with its own createdBy.timezone, like getRun.
    return { items: runs.map((run) => ({ run, actions: actionsByRun.get(run.id) ?? [] })), total };
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

  private async analyse(
    agencyId: string,
    agent: Agent,
    context: RunContext,
    abortSignal: AbortSignal,
    chat?: {
      instruction: string;
      parentState: RequirementsState | null;
      parentRecommendations: RecommendationCarry[];
      parentTiming: ResolvedTiming | null;
      history: ChatTurn[];
    },
  ) {
    const trigger: AssistantRunTrigger = chat ? 'chat' : 'analysis';
    const parentState = chat?.parentState ?? null;

    const extraction = await this.extractor.extract({
      agencyName: agent.agency.name,
      areas: context.areas,
      conversation: context.conversation,
      analysedMessageId: context.message.id,
      agentInstruction: chat?.instruction,
      currentRequirements: chat ? toAgentBrief(parentState ?? emptyRequirementsState()) : undefined,
      abortSignal,
    });

    // On a chat turn the parent's state is the base and only the fields Sara restated overwrite it.
    const merged: RequirementsState = mergeRequirements(parentState, extraction.update);
    const chosenRoute = route({ trigger, intent: extraction.intent, closed: extraction.closed, state: merged });
    const requirements = toContractRequirements(merged);

    let summary: string;
    let reply: string;
    let recommendations: RecommendationSnapshot[] = [];
    let followUpTask: { title: string; notes: string | null } | null;
    let trace: ReturnType<Trace['toContract']> = [];
    let droppedRecommendations: RejectedRecommendation[] = [];

    if (chosenRoute === 'search' || chosenRoute === 'property_question') {
      const carried = chat?.parentRecommendations ?? [];
      const agentResult = await this.agentRunner.run({
        agencyId,
        agencyName: agent.agency.name,
        agentName: agent.name,
        requirements: toAgentBrief(merged),
        mode: chosenRoute,
        agentInstruction: chat?.instruction,
        history: chat?.history,
        previousRecommendationIds: carried.map((r) => r.propertyId),
        propertyRefs: extraction.propertyRefs,
        abortSignal,
      });
      trace = agentResult.trace.toContract();
      summary = agentResult.output.summary;
      reply = agentResult.output.reply;
      followUpTask = agentResult.output.followUpTask;

      // architecture section 2: on `property_question` the recommendations are the PARENT's, carried
      // forward and re-verified -- not whatever the agent returned. Otherwise a "what's the service
      // charge?" turn, where returning [] is the sensible answer, would wipe them.
      const carryForward = chosenRoute === 'property_question';
      const candidates = carryForward ? carried : agentResult.output.recommendations;
      // `carried` is handed over ONLY when it IS the candidate list. On the search route the
      // candidates are the model's own picks, and pre-trusting the parent's ids there would let it
      // re-list one with a fabricated price or yield in `reason` without any tool call this turn.
      const snapshots = await this.buildRecommendationSnapshots(agencyId, candidates, merged, trace, carryForward ? carried : []);
      recommendations = snapshots.accepted;
      droppedRecommendations = snapshots.dropped;
    } else {
      const template = this.templateFor(chosenRoute, context.lead.name);
      summary = template.summary;
      reply = template.reply;
      followUpTask = template.followUpTask;

      // architecture section 2 gives `change_follow_up` the parent's recommendations, carried
      // forward and re-verified. Leaving them at [] would report "nothing fits" for a lead whose
      // listings are untouched, and -- since only the immediate parent is read -- would lose the
      // shortlist for every later turn too. `rent`/`clarify`/`closed` are legitimately empty.
      const carried = chat?.parentRecommendations ?? [];
      if (chosenRoute === 'change_follow_up' && carried.length > 0) {
        const snapshots = await this.buildRecommendationSnapshots(agencyId, carried, merged, trace, carried);
        recommendations = snapshots.accepted;
        droppedRecommendations = snapshots.dropped;
      }
    }

    const { dueAt, needsClarification } = this.resolveTiming({
      followUp: extraction.followUp,
      conversation: context.conversation,
      analysedMessageSentAt: context.message.sentAt,
      timezone: agent.timezone,
      inherited: chat?.parentTiming ?? null,
    });

    // Whether a follow-up is proposed is decided here, by route (architecture section 2), never by
    // the model: `followUpTask` is an optional field the model may leave null, so letting it decide
    // made the action count a coin flip between runs. The model only contributes the wording.
    const proposedAction = proposesFollowUp(chosenRoute)
      ? {
          title: followUpTask?.title ?? followUpTitle(context.lead.name),
          notes: followUpTask?.notes ?? null,
          dueAt,
          needsClarification,
        }
      : null;

    return {
      requirements,
      recommendations,
      summary,
      reply,
      proposedAction,
      trace,
      // `state` is additive and internal: it is the only lossless record of the requirements, and a
      // chat turn needs it to merge onto (the `requirements` column drops budget.qualifier and
      // collapses the bedroom range). The contract's own fields are untouched.
      extraction: {
        bedroomsRange: bedroomsRange(merged),
        rejected: extraction.rejected,
        propertyRefs: extraction.propertyRefs,
        state: merged,
        // `requirements.budgetAed` stays literally what the lead said, which is what "what was
        // understood" means -- but a qualifier like "around" widens the ceiling used for matching,
        // so a recommendation can sit above the reported max. This is that real ceiling, exposed
        // here rather than inside `budgetAed`: adding a key to an existing contract field would
        // change its shape, which TASK.md forbids, while `extraction` is additive already.
        budgetEffectiveMaxAed: effectiveMaxAed(merged.budget?.value ?? null),
        // Additive and internal, like `state`: a later chat turn that says nothing about timing
        // inherits this instead of re-resolving it to "unknown".
        timing: { dueAt, needsClarification },
      },
      // architecture section 3.6: a removed recommendation is recorded with its reason, so a
      // carried-forward listing that no longer fits is visible rather than silently vanishing.
      steps: [
        { step: 'route', route: chosenRoute, trigger },
        ...budgetToleranceStep(merged),
        ...droppedRecommendations.map((d) => ({ step: 'recommendation_rejected' as const, propertyId: d.propertyId, reason: d.why })),
        ...extraction.rejected.map((r) => ({ step: 'field_rejected' as const, field: r.field, reason: r.reason })),
      ],
    };
  }

  /**
   * Resolves the follow-up date for a run.
   *
   * Two things matter here, both of which a chat turn gets wrong if handled naively:
   *
   * - **What the phrase is relative to.** TASK.md pins a lead's "tomorrow" to the day after *their
   *   message* was sent, "even if Sara reads it a day later". The agent's own chat turn is instead
   *   relative to now. `followUp.source` says which, so the anchor follows the quote rather than
   *   the trigger.
   * - **A turn that says nothing about timing must not erase it.** Timing is not part of
   *   `RequirementsState`, so `mergeRequirements` cannot carry it. Without the inherited fallback a
   *   chat turn re-derives from a null timing and reports "The lead did not say when to follow up."
   *   on a run whose own message said exactly when -- and the newest run is the one Sara sees.
   */
  private resolveTiming(input: {
    followUp: FollowUpTiming | null;
    conversation: ConversationMessage[];
    analysedMessageSentAt: Date;
    timezone: string;
    inherited: ResolvedTiming | null;
  }): ResolvedTiming {
    if (input.followUp === null) {
      // Nothing stated this turn: keep whatever the parent already resolved, rather than
      // re-deriving it as "unknown". An analysis run has nothing to inherit, so it still computes.
      if (input.inherited !== null) return input.inherited;
      return computeDueAt(null, input.analysedMessageSentAt, input.timezone);
    }

    const anchor =
      input.followUp.source === AGENT_INSTRUCTION_SOURCE_ID
        ? // The agent is speaking now, so "Tuesday" means the next Tuesday from today. Via luxon
          // rather than `new Date()`, per CLAUDE.md; computeDueAt converts into the agent timezone.
          DateTime.utc().toJSDate()
        : this.sentAtOf(input.followUp.source, input.conversation) ?? input.analysedMessageSentAt;

    return computeDueAt(input.followUp, anchor, input.timezone);
  }

  private sentAtOf(sourceId: string | undefined, conversation: ConversationMessage[]): Date | null {
    if (sourceId === undefined) return null;
    const message = conversation.find((m) => m.id === sourceId);
    return message ? DateTime.fromISO(message.sentAt).toJSDate() : null;
  }

  private templateFor(chosenRoute: Exclude<Route, 'search' | 'property_question'>, leadName: string): TemplateOutput {
    switch (chosenRoute) {
      case 'rent':
        return rentTemplate(leadName);
      case 'clarify':
        return clarifyTemplate(leadName);
      case 'closed':
        return closedTemplate(leadName);
      case 'change_follow_up':
        return changeFollowUpTemplate(leadName);
    }
  }

  private async buildRecommendationSnapshots(
    agencyId: string,
    candidates: Candidate[],
    requirements: RequirementsState,
    // Entries rather than a Trace: the template routes carry recommendations forward without ever
    // running the agent, so they have no Trace object to hand over.
    traceEntries: ReturnType<Trace['toContract']>,
    carried: RecommendationCarry[] = [],
  ): Promise<{ accepted: RecommendationSnapshot[]; dropped: RejectedRecommendation[] }> {
    const seenIds = collectSeenPropertyIds(traceEntries);
    // architecture section 3.6 step 3: a listing qualifies if it appeared in THIS run's tool output
    // OR was carried forward from the parent. Carried ids still face every other check below --
    // existence, agency scope, `available`, and the hard constraints -- so "re-verified" is literal.
    for (const item of carried) seenIds.add(item.propertyId);

    const facts = await this.propertyQuery.factsByIds(agencyId, candidates.map((c) => c.propertyId));

    const { accepted, rejected } = filterRecommendations({ candidates, facts, agencyId, requirements, seenIds });
    const preferences = requirements.preferences.map((p) => p.value);
    const selected = selectRecommendations({ accepted, facts, preferences });

    const snapshots = selected.map((candidate) => {
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

    return { accepted: snapshots, dropped: rejected };
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
    extraction?: { bedroomsRange: { min: number; max: number } | null; rejected: unknown; propertyRefs: string[]; state?: RequirementsState };
    steps?: unknown[];
    trigger?: AssistantRunTrigger;
    parentRunId?: string;
    agentMessage?: string;
  }): Promise<{ run: AssistantRun; actions: AssistantAction[] }> {
    const fork = this.em.fork();

    const run = fork.create(AssistantRun, {
      agency: fork.getReference(Agency, data.agencyId),
      lead: fork.getReference(Lead, data.leadId),
      message: fork.getReference(Message, data.messageId),
      createdBy: fork.getReference(Agent, data.agentId),
      trigger: data.trigger ?? 'analysis',
      parentRun: data.parentRunId ? fork.getReference(AssistantRun, data.parentRunId) : null,
      agentMessage: data.agentMessage ?? null,
      status: data.status,
      error: data.error ?? null,
      summary: data.summary,
      reply: data.reply,
      requirements: data.requirements,
      extraction: data.extraction ?? { bedroomsRange: null, rejected: [], propertyRefs: [] },
      recommendations: data.recommendations,
      trace: data.trace,
      steps: data.steps ?? [],
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
