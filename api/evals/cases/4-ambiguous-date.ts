import assert from 'node:assert/strict';
import { addMessage, assertCompleted, createRun, EvalCase, stableId } from '../harness';

export const case4AmbiguousDate: EvalCase = {
  name: '4-ambiguous-date',
  category: 'ambiguous-date',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const message = await addMessage(app, saraToken, leadId, {
      direction: 'inbound',
      channel: 'whatsapp',
      body: 'call me sometime next week',
    });

    const run = await createRun(app, saraToken, leadId, message.id);
    assertCompleted(run);

    assert.strictEqual(run.proposedActions.length, 1, 'expected exactly one proposed action');
    const action = run.proposedActions[0];
    assert.strictEqual(action.task.dueAt, null, 'an unclear date must not produce a dueAt');
    assert.ok(action.needsClarification, 'expected a non-empty needsClarification');

    return { trace: run.trace };
  },
};
