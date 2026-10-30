import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

export const case1aExtractionKarim: EvalCase = {
  name: '1a-extraction-karim',
  category: 'extraction',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);

    assertCompleted(run);
    assert.deepEqual(run.requirements.locations, ['Dubai Marina']);
    assert.strictEqual(run.requirements.bedrooms, 2);
    assert.strictEqual(run.requirements.budgetAed.max, 2_000_000);
    assert.strictEqual(run.requirements.propertyType, 'apartment');
    assert.strictEqual(run.requirements.intent, 'buy');
    assert.ok(
      run.requirements.preferences.some((p: string) => /yield/i.test(p)),
      `expected a yield-related preference, got ${JSON.stringify(run.requirements.preferences)}`,
    );

    return { trace: run.trace };
  },
};
