import { MockLanguageModelV3 } from 'ai/test';
import { AgentRequirementsBrief } from '../types';
import { PropertyQuery } from './property-query';
import { ToolsFactory } from './tools';
import { AgentFailedError, AgentRunner } from './agent-runner';

function usage() {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function textStep(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

function toolCallStep(toolCallId: string, toolName: string, input: unknown) {
  return {
    content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

const REQUIREMENTS: AgentRequirementsBrief = {
  locations: ['Dubai Marina'],
  bedroomsRange: { min: 2, max: 2 },
  budget: { minAed: null, maxAed: 2_000_000, qualifier: 'around', effectiveMaxAed: 2_100_000 },
  propertyType: 'apartment',
  intent: 'buy',
  preferences: ['good rental yield'],
};

function stubToolsFactory(searchResult: { items: unknown[]; total: number } = { items: [], total: 0 }): ToolsFactory {
  const propertyQuery = { search: jest.fn().mockResolvedValue(searchResult) } as unknown as PropertyQuery;
  return new ToolsFactory(propertyQuery);
}

function runnerWith(toolsFactory: ToolsFactory, ...steps: unknown[]): AgentRunner {
  const model = new MockLanguageModelV3({ doGenerate: steps as never });
  return new AgentRunner(() => model, toolsFactory);
}

describe('AgentRunner', () => {
  it('records a tool call whose arguments fail the schema, which never reaches execute', async () => {
    // The SDK marks such a call invalid, skips execute and hands the model a tool-error to retry
    // from -- so the traced() wrapper never sees it and it was missing from the trace entirely.
    // TASK.md's trace is "every tool call, in order".
    const toolsFactory = stubToolsFactory({ items: [], total: 0 });
    const runner = runnerWith(
      toolsFactory,
      toolCallStep('call-bad', 'search_properties', { bedroomsMin: 'not a number' }),
      textStep({ recommendations: [], summary: 'Nothing.', reply: 'Nothing.', followUpTask: null }),
    );

    const result = await runner.run({
      agencyId: 'agency-1',
      agencyName: 'Marina Bay',
      agentName: 'Sara',
      requirements: REQUIREMENTS,
    });

    const entries = result.trace.toContract();
    const bad = entries.find((entry) => entry.error !== undefined);
    expect(bad).toBeDefined();
    expect(bad?.tool).toBe('search_properties');
    expect(bad?.error).toBeTruthy();
  });

  it("reports a tool's real failure, not the abort it triggers", async () => {
    // The infra failure aborts the run, so whatever generateText throws afterwards is the abort.
    // The run's `error` field is the first thing anyone reads, so it has to name the cause.
    const propertyQuery = {
      search: jest.fn().mockRejectedValue(new Error('connection refused')),
    } as unknown as PropertyQuery;
    const runner = runnerWith(new ToolsFactory(propertyQuery), toolCallStep('call-1', 'search_properties', { areas: ['Dubai Marina'] }));

    await expect(runner.run({ agencyId: 'agency-1', agencyName: 'Marina Bay', agentName: 'Sara', requirements: REQUIREMENTS })).rejects.toThrow(
      /connection refused/,
    );
  });

  it('runs a tool call then resolves the final structured output, with the call captured in the trace', async () => {
    const toolsFactory = stubToolsFactory({ items: [{ id: 'prop-1', reference: 'MBR-1001' }], total: 1 });
    const runner = runnerWith(
      toolsFactory,
      toolCallStep('call-1', 'search_properties', { areas: ['Dubai Marina'] }),
      textStep({ recommendations: [], summary: 'Found one option.', reply: 'Here is what I found.', followUpTask: null }),
    );

    const { output, trace } = await runner.run({ agencyId: 'agency-1', agencyName: 'Marina Bay Realty', agentName: 'Sara', requirements: REQUIREMENTS });

    expect(output.summary).toBe('Found one option.');
    const entries = trace.toContract();
    expect(entries).toHaveLength(1);
    expect(entries[0].tool).toBe('search_properties');
    expect(entries[0].output).toEqual({ items: [{ id: 'prop-1', reference: 'MBR-1001' }], total: 1 });
  });

  it('fails when every step calls a tool and the step budget runs out before a final answer', async () => {
    const toolsFactory = stubToolsFactory();
    const steps = Array.from({ length: 8 }, (_, i) => toolCallStep(`call-${i}`, 'search_properties', {}));
    const runner = runnerWith(toolsFactory, ...steps);

    await expect(
      runner.run({ agencyId: 'agency-1', agencyName: 'Marina Bay Realty', agentName: 'Sara', requirements: REQUIREMENTS }),
    ).rejects.toBeInstanceOf(AgentFailedError);
  });

  it('fails when the model never produces a schema-valid final object', async () => {
    const toolsFactory = stubToolsFactory();
    const runner = runnerWith(toolsFactory, textStep({ not: 'the right shape' }));

    await expect(
      runner.run({ agencyId: 'agency-1', agencyName: 'Marina Bay Realty', agentName: 'Sara', requirements: REQUIREMENTS }),
    ).rejects.toBeInstanceOf(AgentFailedError);
  });

  it('a final object violating a schema length cap is rejected by validation, not silently truncated', async () => {
    const toolsFactory = stubToolsFactory();
    const runner = runnerWith(
      toolsFactory,
      textStep({ recommendations: [], summary: 'x'.repeat(801), reply: 'ok', followUpTask: null }),
    );

    await expect(
      runner.run({ agencyId: 'agency-1', agencyName: 'Marina Bay Realty', agentName: 'Sara', requirements: REQUIREMENTS }),
    ).rejects.toBeInstanceOf(AgentFailedError);
  });
});
