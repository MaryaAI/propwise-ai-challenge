import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, sendChatMessage, stableId } from '../harness';

/**
 * Architecture section 13's case 13. Narrowing the budget in chat must change only the budget:
 * everything else carries over from the parent run, which is what makes `mergeRequirements(parent,
 * update)` and the persisted `extraction.state` worth having.
 */
export const case13ChatNarrowing: EvalCase = {
  name: '13-chat-narrowing',
  category: 'chat-narrowing',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const parent = await createRun(app, saraToken, leadId, messageId);
    assertCompleted(parent);
    assert.strictEqual(parent.requirements.budgetAed.max, 2_000_000, 'precondition: the parent run should have Karim at 2M');

    const chat = await sendChatMessage(app, saraToken, leadId, parent.id, 'Only show options under 1.9M');
    assertCompleted(chat);

    // The stated field changed...
    assert.strictEqual(chat.requirements.budgetAed.max, 1_900_000);

    // ...and nothing else did. These came from the parent, not from this turn's text.
    assert.deepEqual(chat.requirements.locations, parent.requirements.locations);
    assert.strictEqual(chat.requirements.bedrooms, parent.requirements.bedrooms);
    assert.strictEqual(chat.requirements.propertyType, parent.requirements.propertyType);
    assert.strictEqual(chat.requirements.intent, parent.requirements.intent);

    // Every recommendation respects the new ceiling. "under" takes no tolerance (PLAN.md decision 1).
    for (const rec of chat.recommendations) {
      assert.ok(
        rec.property.priceAed <= 1_900_000,
        `${rec.property.reference} at ${rec.property.priceAed} exceeds the narrowed 1.9M ceiling`,
      );
      assert.strictEqual(rec.property.status, 'available');
      assert.strictEqual(rec.property.area, 'Dubai Marina');
    }

    return { trace: chat.trace };
  },
};
