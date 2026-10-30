/** Thrown by a tool's own validation. Recorded in the trace and rethrown as-is; the run is not aborted. */
export class ToolInputError extends Error {}

/** Thrown when a tool fails for an infrastructure reason (database, service). Aborts the run. */
export class ToolInfraError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

interface TraceEntry {
  toolCallId: string;
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  durationMs: number;
}

type ToolExecute<Input, Output> = (input: Input, options: { toolCallId: string }) => Promise<Output>;

export interface Trace {
  traced<Input, Output>(toolName: string, execute: (input: Input) => Promise<Output>): ToolExecute<Input, Output>;
  recordInputError(toolCallId: string, tool: string, input: unknown, message: string): void;
  hasInfraFailure(): boolean;
  firstInfraError(): string | null;
  toContract(): Array<{ tool: string; input: unknown; output?: unknown; error?: string; durationMs: number }>;
}

export function createTrace(abortController: AbortController): Trace {
  const entries: TraceEntry[] = [];
  let infraError: string | null = null;

  function traced<Input, Output>(toolName: string, execute: (input: Input) => Promise<Output>): ToolExecute<Input, Output> {
    return async (input: Input, options: { toolCallId: string }): Promise<Output> => {
      const startedAt = Date.now();
      try {
        const output = await execute(input);
        entries.push({
          toolCallId: options.toolCallId,
          tool: toolName,
          input,
          output: output ?? null,
          startedAt,
          durationMs: Date.now() - startedAt,
        });
        return output;
      } catch (error) {
        const durationMs = Date.now() - startedAt;

        if (error instanceof ToolInputError) {
          entries.push({ toolCallId: options.toolCallId, tool: toolName, input, error: error.message, startedAt, durationMs });
          throw error;
        }

        const message = error instanceof Error ? error.message : String(error);
        entries.push({ toolCallId: options.toolCallId, tool: toolName, input, error: message, startedAt, durationMs });
        infraError = message;
        abortController.abort();
        throw new ToolInfraError(message, { cause: error });
      }
    };
  }

  function recordInputError(toolCallId: string, tool: string, input: unknown, message: string): void {
    entries.push({ toolCallId, tool, input, error: message, startedAt: Date.now(), durationMs: 0 });
  }

  function hasInfraFailure(): boolean {
    return infraError !== null;
  }

  function firstInfraError(): string | null {
    return infraError;
  }

  function toContract() {
    return [...entries]
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((entry) => ({
        tool: entry.tool,
        input: entry.input,
        ...(entry.error === undefined ? { output: entry.output } : {}),
        ...(entry.error !== undefined ? { error: entry.error } : {}),
        durationMs: entry.durationMs,
      }));
  }

  return { traced, recordInputError, hasInfraFailure, firstInfraError, toContract };
}
