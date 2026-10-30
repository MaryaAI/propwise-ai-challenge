import assert from 'node:assert/strict';
import { approve, createRun, EvalCase, httpRequest, listTasks, reject, stableId } from '../harness';

export const case8NoActionWithoutApproval: EvalCase = {
  name: '8-no-action-without-approval',
  category: 'no-action-without-approval',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const tasksBefore = await listTasks(app, saraToken, leadId);

    // Run A: a run alone creates no task; approving its action twice still creates exactly one.
    const runA = await createRun(app, saraToken, leadId);
    const tasksAfterRun = await listTasks(app, saraToken, leadId);
    assert.strictEqual(tasksAfterRun.length, tasksBefore.length, 'a run alone must create no task');
    assert.strictEqual(runA.proposedActions.length, 1);
    const actionA = runA.proposedActions[0];

    const firstApprove = await approve(app, saraToken, leadId, runA.id, actionA.id);
    const secondApprove = await approve(app, saraToken, leadId, runA.id, actionA.id);
    assert.strictEqual(secondApprove.task.id, firstApprove.task.id, 'approving twice must return the same task');

    const tasksAfterApprove = await listTasks(app, saraToken, leadId);
    assert.strictEqual(tasksAfterApprove.length, tasksBefore.length + 1, 'approving twice must create exactly one task');

    // Run B: independent of A -- reject then approve is a 409; reject again is a 200.
    const runB = await createRun(app, saraToken, leadId);
    assert.strictEqual(runB.proposedActions.length, 1);
    const actionB = runB.proposedActions[0];

    await reject(app, saraToken, leadId, runB.id, actionB.id);
    const approveAfterReject = await httpRequest(app, saraToken, 'post', `/leads/${leadId}/assistant/runs/${runB.id}/actions/${actionB.id}/approve`);
    assert.strictEqual(approveAfterReject.status, 409, 'approving a rejected action must be a conflict');
    const rejectAgain = await httpRequest(app, saraToken, 'post', `/leads/${leadId}/assistant/runs/${runB.id}/actions/${actionB.id}/reject`);
    assert.strictEqual(rejectAgain.status, 200, 'rejecting an already-rejected action must still be 200');

    return { trace: [...runA.trace, ...runB.trace] };
  },
};
