import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

export const case1bExtractionFatima: EvalCase = {
  name: '1b-extraction-fatima',
  category: 'extraction',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'fatima');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);

    assertCompleted(run);
    assert.deepEqual(run.requirements.locations, ['Dubai Marina']);
    assert.strictEqual(run.requirements.bedrooms, 2);
    assert.strictEqual(run.requirements.budgetAed.max, 2_000_000);

    return { trace: run.trace };
  },
};
