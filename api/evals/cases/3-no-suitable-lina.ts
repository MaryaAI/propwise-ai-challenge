import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

export const case3NoSuitableLina: EvalCase = {
  name: '3-no-suitable-lina',
  category: 'no-suitable',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'lina');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);

    assertCompleted(run);
    assert.deepEqual(run.recommendations, []);

    return { trace: run.trace };
  },
};
