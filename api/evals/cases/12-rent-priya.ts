import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

export const case12RentPriya: EvalCase = {
  name: '12-rent-priya',
  category: 'rent',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'priya');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);

    assertCompleted(run);
    assert.strictEqual(run.requirements.intent, 'rent');
    assert.deepEqual(run.recommendations, []);

    return { trace: run.trace };
  },
};
