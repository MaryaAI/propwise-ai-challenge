import { Inject, Injectable } from '@nestjs/common';
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, stepCountIs } from 'ai';
import { AssistantModelFactory, ASSISTANT_MODEL_FACTORY } from '../model';
import { AgentRequirementsBrief } from '../types';
import { FinalOutput, FinalSchema } from './final-schema';
import { AgentMode, buildAgentSystemPrompt, buildAgentUserPrompt } from './prompts';
import { createTrace, Trace } from './tracing';
import { ToolsFactory } from './tools';

export class AgentFailedError extends Error {
  constructor(message: string, public readonly trace: Trace) {
    super(message);
  }
}

export interface AgentRunResult {
  output: FinalOutput;
  trace: Trace;
}

/** The SDK types a tool-error's `error` as `unknown`, so it is narrowed in one place. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

@Injectable()
export class AgentRunner {
  constructor(
    @Inject(ASSISTANT_MODEL_FACTORY) private readonly modelFactory: AssistantModelFactory,
    private readonly toolsFactory: ToolsFactory,
  ) {}

  async run(input: {
    agencyId: string;
    agencyName: string;
    agentName: string;
    requirements: AgentRequirementsBrief;
    /** 'search' looks for new listings; 'property_question' answers about known ones. */
    mode?: AgentMode;
    /** The agent's own chat turn: a trusted instruction, unlike a lead's message. */
    agentInstruction?: string;
    history?: { agentMessage: string; reply: string }[];
    previousRecommendationIds?: string[];
    propertyRefs?: string[];
    abortSignal?: AbortSignal;
  }): Promise<AgentRunResult> {
    const abortController = new AbortController();
    if (input.abortSignal) {
      if (input.abortSignal.aborted) abortController.abort();
      else input.abortSignal.addEventListener('abort', () => abortController.abort());
    }

    const trace = createTrace(abortController);
    const tools = this.toolsFactory.create({ agencyId: input.agencyId, trace });

    try {
      const result = await generateText({
        model: this.modelFactory(),
        system: buildAgentSystemPrompt({ ...input, mode: input.mode ?? 'search' }),
        prompt: buildAgentUserPrompt({
          requirements: input.requirements,
          agentInstruction: input.agentInstruction,
          history: input.history,
          previousRecommendationIds: input.previousRecommendationIds,
          propertyRefs: input.propertyRefs,
        }),
        tools,
        stopWhen: stepCountIs(8),
        output: Output.object({ schema: FinalSchema }),
        abortSignal: abortController.signal,
        // A tool call whose arguments fail the schema never reaches `execute` -- the SDK marks it
        // invalid, skips execution and hands the model a `tool-error` part to retry from. Correct
        // behaviour (architecture section 3.6: an input error goes back to the model and does not
        // fail the run), but it means the `traced()` wrapper never sees the call, so it was missing
        // from the trace entirely. TASK.md's `trace` is "every tool call, in order", so it is
        // recorded here instead. Observation only -- nothing about the run changes.
        onStepFinish: ({ content }) => {
          for (const part of content) {
            if (part.type !== 'tool-error') continue;
            trace.recordInputError(part.toolCallId, part.toolName, part.input, errorText(part.error));
          }
        },
      });
      return { output: result.output, trace };
    } catch (error) {
      // A tool's infrastructure failure aborts the run, so what `generateText` throws afterwards is
      // the abort ("This operation was aborted"), not the cause. The trace recorded the real reason
      // when the tool failed, so report that instead -- otherwise the run's `error` field, which is
      // the first thing anyone reads, names the symptom and hides the cause.
      if (trace.hasInfraFailure()) {
        throw new AgentFailedError(trace.firstInfraError() ?? 'A tool failed.', trace);
      }
      if (NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error)) {
        throw new AgentFailedError(error.message, trace);
      }
      // Anything else (an abort from the run timeout, a network error, ...) propagates as-is, but
      // still carries the trace gathered so far -- architecture section 3.8: trace/steps survive a
      // failed run for diagnosis.
      if (error instanceof Error) (error as Error & { trace?: Trace }).trace = trace;
      throw error;
    }
  }
}
