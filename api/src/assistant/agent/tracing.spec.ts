import { createTrace, ToolInfraError, ToolInputError } from './tracing';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('createTrace', () => {
  it('records the output of a successful call', async () => {
    const abortController = new AbortController();
    const trace = createTrace(abortController);
    const execute = trace.traced('search_properties', async (input: { q: string }) => ({ items: [input.q] }));

    const result = await execute({ q: 'marina' }, { toolCallId: 'call-1' });

    expect(result).toEqual({ items: ['marina'] });
    expect(trace.toContract()).toEqual([
      { tool: 'search_properties', input: { q: 'marina' }, output: { items: ['marina'] }, durationMs: expect.any(Number) },
    ]);
  });

  it('records an undefined output as null', async () => {
    const trace = createTrace(new AbortController());
    const execute = trace.traced('noop', async () => undefined);

    await execute(undefined, { toolCallId: 'call-1' });

    const [entry] = trace.toContract();
    expect(entry.output).toBeNull();
  });

  it('records and rethrows a ToolInputError without aborting', async () => {
    const abortController = new AbortController();
    const trace = createTrace(abortController);
    const execute = trace.traced('get_property', async () => {
      throw new ToolInputError('Provide exactly one of id or reference.');
    });

    await expect(execute({}, { toolCallId: 'call-1' })).rejects.toBeInstanceOf(ToolInputError);

    expect(abortController.signal.aborted).toBe(false);
    expect(trace.hasInfraFailure()).toBe(false);
    const [entry] = trace.toContract();
    expect(entry.error).toBe('Provide exactly one of id or reference.');
    expect(entry.output).toBeUndefined();
  });

  it('records a plain error, aborts, and rethrows as ToolInfraError', async () => {
    const abortController = new AbortController();
    const trace = createTrace(abortController);
    const execute = trace.traced('search_properties', async () => {
      throw new Error('connection refused');
    });

    await expect(execute({}, { toolCallId: 'call-1' })).rejects.toBeInstanceOf(ToolInfraError);

    expect(abortController.signal.aborted).toBe(true);
    expect(trace.hasInfraFailure()).toBe(true);
    expect(trace.firstInfraError()).toBe('connection refused');
    const [entry] = trace.toContract();
    expect(entry.error).toBe('connection refused');
    expect(entry.output).toBeUndefined();
  });

  it('orders entries by actual start time, not completion order', async () => {
    const trace = createTrace(new AbortController());
    const slowStartedFirst = trace.traced('slow', async () => {
      await delay(30);
      return 'slow-done';
    });
    const fastStartedSecond = trace.traced('fast', async () => {
      await delay(5);
      return 'fast-done';
    });

    const first = slowStartedFirst(undefined, { toolCallId: 'call-1' });
    await delay(10);
    const second = fastStartedSecond(undefined, { toolCallId: 'call-2' });
    await Promise.all([first, second]);

    expect(trace.toContract().map((entry) => entry.tool)).toEqual(['slow', 'fast']);
  });

  it('never produces an entry with both output and error', async () => {
    const trace = createTrace(new AbortController());
    const ok = trace.traced('ok', async () => 'result');
    const failing = trace.traced('failing', async () => {
      throw new ToolInputError('bad input');
    });

    await ok(undefined, { toolCallId: 'call-1' });
    await expect(failing(undefined, { toolCallId: 'call-2' })).rejects.toThrow();

    for (const entry of trace.toContract()) {
      expect('output' in entry && 'error' in entry).toBe(false);
    }
  });
});
