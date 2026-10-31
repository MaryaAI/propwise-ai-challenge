import type { AssistantRun, ProposedAction } from './api';

export interface LiveProposal {
  run: AssistantRun;
  action: ProposedAction;
}

/**
 * The one proposal the UI shows, out of a lead's whole run chain (newest first).
 *
 * Two rules force this to be a search rather than a read of the newest run:
 *
 * - A chat turn creates a NEW run and leaves the previous run's action `pending_approval`
 *   (PLAN.md decision 10). The contract has no "superseded" status and none may be added, so if
 *   the UI rendered every run's action, the same follow-up could be approved twice into two tasks.
 *   Only the newest may be shown.
 * - A `property_question` chat turn proposes nothing at all (amendment A15) while an older action
 *   is still live. Reading only the newest run would hide the one approvable action.
 *
 * So: walk newest to oldest and take the first run that has an action. Deliberately *any* action,
 * not just a pending one -- a decided action must keep showing so its "Approved"/"Rejected"
 * confirmation is visible, and so approving the newest never resurrects an older stale proposal.
 */
export function liveProposal(runs: AssistantRun[]): LiveProposal | null {
  for (const run of runs) {
    const [action] = run.proposedActions;
    if (action) return { run, action };
  }
  return null;
}
