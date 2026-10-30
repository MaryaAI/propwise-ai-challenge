import assert from 'node:assert/strict';
import { assertFailed, EvalCase, httpRequest, stableId } from '../harness';
import { PropertyQuery } from '../../src/assistant/agent/property-query';

export const case6ToolFailure: EvalCase = {
  name: '6-tool-failure',
  category: 'tool-failure',
  async run({ saraToken, createApp }) {
    // A second app instance whose PropertyQuery is stubbed to fail -- same effect as overriding
    // ToolsFactory (architecture section 13's suggestion), with less mocking surface: the real
    // search_properties tool wrapper runs around a genuinely failing dependency.
    const failingApp = await createApp((builder) =>
      builder.overrideProvider(PropertyQuery).useValue({
        search: async () => {
          throw new Error('simulated infrastructure failure');
        },
        getByIdOrReference: async () => null,
        factsByIds: async () => new Map(),
        distinctAreas: async () => [],
      }),
    );

    try {
      const leadId = stableId('lead', 'karim');
      const response = await httpRequest(failingApp, saraToken, 'post', `/leads/${leadId}/assistant/runs`, {});
      assert.strictEqual(response.status, 201);

      const run = response.body;
      assertFailed(run);
      assert.deepEqual(run.recommendations, []);
      assert.deepEqual(run.proposedActions, []);

      const failingEntry = (run.trace as { error?: string }[]).find((entry) => entry.error !== undefined);
      assert.ok(failingEntry, 'expected a trace entry with an error');

      return { trace: run.trace };
    } finally {
      await failingApp.close();
    }
  },
};
