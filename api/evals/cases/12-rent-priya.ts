import assert from 'node:assert/strict';
import { createRun, EvalCase, stableId } from '../harness';

export const case12RentPriya: EvalCase = {
  name: '12-rent-priya',
  category: 'rent',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'priya');
    const run = await createRun(app, saraToken, leadId);

    assert.strictEqual(run.status, 'completed');
    assert.strictEqual(run.requirements.intent, 'rent');
    assert.deepEqual(run.recommendations, []);

    return { trace: run.trace };
  },
};
