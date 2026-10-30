import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, httpRequest, seedRequirementsMessageId, stableId } from '../harness';

export const case11Isolation: EvalCase = {
  name: '11-isolation',
  category: 'isolation',
  async run({ app, saraToken, omarToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);
    assertCompleted(run);
    assert.strictEqual(run.proposedActions.length, 1);
    const actionId = run.proposedActions[0].id;

    const omarGetRun = await httpRequest(app, omarToken, 'get', `/leads/${leadId}/assistant/runs/${run.id}`);
    assert.strictEqual(omarGetRun.status, 404, "Omar must not be able to read Sara's run");

    const omarApprove = await httpRequest(app, omarToken, 'post', `/leads/${leadId}/assistant/runs/${run.id}/actions/${actionId}/approve`, {});
    assert.strictEqual(omarApprove.status, 404, "Omar must not be able to approve Sara's action");

    return { trace: run.trace };
  },
};
