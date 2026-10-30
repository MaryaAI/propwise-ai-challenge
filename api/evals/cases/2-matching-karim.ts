import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

const ALLOWED = new Set(['MBR-1001', 'MBR-1007', 'MBR-1002', 'MBR-1022'].map((ref) => stableId('property', ref)));

export const case2MatchingKarim: EvalCase = {
  name: '2-matching-karim',
  category: 'matching',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);

    assertCompleted(run);
    assert.ok(run.recommendations.length > 0, 'expected at least one recommendation for Karim');

    for (const rec of run.recommendations) {
      assert.ok(ALLOWED.has(rec.propertyId), `unexpected recommendation ${rec.propertyId} (${rec.property?.reference})`);
      assert.strictEqual(rec.property.status, 'available');
    }

    // Sorted by gross yield descending, unknown (null) yield last -- architecture's own stability note
    // accepts this robust form even if the exact set/order of ids varies slightly between real runs.
    for (let i = 1; i < run.recommendations.length; i++) {
      const previous = run.recommendations[i - 1].property.grossYield;
      const current = run.recommendations[i].property.grossYield;
      if (previous === null) {
        assert.strictEqual(current, null, 'a null-yield listing must not be followed by a known-yield one');
      } else if (current !== null) {
        assert.ok(previous >= current, 'expected gross yield to be non-increasing');
      }
    }

    return { trace: run.trace };
  },
};
