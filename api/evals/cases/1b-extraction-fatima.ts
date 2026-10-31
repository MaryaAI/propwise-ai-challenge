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
    // Fatima's message is Karim's in Arabic. Without this the buy/rent inference could flip her to
    // 'rent' -- which short-circuits the router to the no-agent rent route -- and still pass.
    assert.strictEqual(run.requirements.intent, 'buy');

    return { trace: run.trace };
  },
};
