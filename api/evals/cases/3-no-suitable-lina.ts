import assert from 'node:assert/strict';
import { createRun, EvalCase, stableId } from '../harness';

export const case3NoSuitableLina: EvalCase = {
  name: '3-no-suitable-lina',
  category: 'no-suitable',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'lina');
    const run = await createRun(app, saraToken, leadId);

    assert.strictEqual(run.status, 'completed');
    assert.deepEqual(run.recommendations, []);

    return { trace: run.trace };
  },
};
