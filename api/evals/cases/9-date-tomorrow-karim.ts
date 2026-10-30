import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, getLead, stableId } from '../harness';
import { computeDueAt } from '../../src/assistant/policy/follow-up-date';

/**
 * Seed times are relative to "now", so the expected dueAt is computed live from the real
 * message.sentAt via the same `computeDueAt` already proven exhaustively in Phase 2's unit tests --
 * this case is testing that the service wires the real sentAt through correctly, not the date math.
 */
export const case9DateTomorrowKarim: EvalCase = {
  name: '9-date-tomorrow-karim',
  category: 'date',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const lead = await getLead(app, saraToken, leadId);
    const inbound = lead.messages.find((m: { direction: string }) => m.direction === 'inbound');

    const expected = computeDueAt({ kind: 'tomorrow', weekday: null, days: null, time: null, raw: null }, new Date(inbound.sentAt), 'Asia/Dubai');

    const run = await createRun(app, saraToken, leadId, inbound.id);
    assertCompleted(run);
    assert.strictEqual(run.proposedActions.length, 1);
    assert.strictEqual(run.proposedActions[0].task.dueAt, expected.dueAt);

    return { trace: run.trace };
  },
};
