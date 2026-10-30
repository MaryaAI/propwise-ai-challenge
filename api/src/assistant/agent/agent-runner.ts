import { Inject, Injectable } from '@nestjs/common';
import { generateText, NoObjectGeneratedError, NoOutputGeneratedError, Output, stepCountIs } from 'ai';
import { AssistantModelFactory, ASSISTANT_MODEL_FACTORY } from '../model';
import { ContractRequirements } from '../types';
import { FinalOutput, FinalSchema } from './final-schema';
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './prompts';
import { createTrace, Trace } from './tracing';
import { ToolsFactory } from './tools';

export class AgentFailedError extends Error {}

export interface AgentRunResult {
  output: FinalOutput;
  trace: Trace;
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
    requirements: ContractRequirements;
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
        system: buildAgentSystemPrompt(input),
        prompt: buildAgentUserPrompt({ requirements: input.requirements }),
        tools,
        stopWhen: stepCountIs(8),
        output: Output.object({ schema: FinalSchema }),
        abortSignal: abortController.signal,
      });
      return { output: result.output, trace };
    } catch (error) {
      if (NoOutputGeneratedError.isInstance(error) || NoObjectGeneratedError.isInstance(error)) {
        throw new AgentFailedError(error.message);
      }
      throw error;
    }
  }
}
