import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, getLead, stableId } from '../harness';
import { computeDueAt } from '../../src/assistant/policy/follow-up-date';

export const case10DateAfterWeekendJames: EvalCase = {
  name: '10-date-after-weekend-james',
  category: 'date',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'james');
    const lead = await getLead(app, saraToken, leadId);
    const inbound = lead.messages.find((m: { direction: string }) => m.direction === 'inbound');

    const expected = computeDueAt(
      { kind: 'after_weekend', weekday: null, days: null, time: null, raw: null },
      new Date(inbound.sentAt),
      'Asia/Dubai',
    );

    const run = await createRun(app, saraToken, leadId, inbound.id);
    assertCompleted(run);
    assert.strictEqual(run.proposedActions.length, 1);
    assert.strictEqual(run.proposedActions[0].task.dueAt, expected.dueAt);
    assert.ok(run.requirements.locations.includes('Jumeirah Lake Towers'), `expected JLT in ${JSON.stringify(run.requirements.locations)}`);
    assert.ok(run.requirements.locations.includes('Dubai Marina'), `expected Dubai Marina in ${JSON.stringify(run.requirements.locations)}`);

    return { trace: run.trace };
  },
};
