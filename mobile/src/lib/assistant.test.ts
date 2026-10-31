import type { AssistantRun, ProposedAction } from './api';
import { liveProposal } from './assistant';

function action(id: string, status: ProposedAction['status'] = 'pending_approval'): ProposedAction {
  return {
    id,
    type: 'create_follow_up_task',
    status,
    task: { title: `Follow up (${id})`, notes: null, dueAt: null },
    needsClarification: null,
  };
}

/** Runs arrive newest first, as `GET /runs` returns them. */
function run(id: string, proposedActions: ProposedAction[], trigger: AssistantRun['trigger'] = 'analysis'): AssistantRun {
  return {
    id,
    leadId: 'lead-1',
    messageId: 'msg-1',
    status: 'completed',
    requirements: {
      locations: [],
      bedrooms: null,
      budgetAed: { min: null, max: null },
      propertyType: null,
      intent: 'unknown',
      preferences: [],
    },
    recommendations: [],
    summary: '',
    proposedActions,
    trace: [],
    createdAt: '2026-10-30T06:00:00.000Z',
    parentRunId: null,
    trigger,
    agentMessage: null,
    reply: '',
  };
}

describe('liveProposal', () => {
  it('finds nothing when there are no runs', () => {
    expect(liveProposal([])).toBeNull();
  });

  it('finds nothing when no run ever proposed anything', () => {
    expect(liveProposal([run('r2', []), run('r1', [])])).toBeNull();
  });

  it("takes the newest run's action", () => {
    const result = liveProposal([run('r2', [action('a2')]), run('r1', [action('a1')])]);
    expect(result?.action.id).toBe('a2');
    expect(result?.run.id).toBe('r2');
  });

  it('shows only one proposal when two runs both have a pending action', () => {
    // PLAN.md decision 10: a chat turn leaves the parent's action pending. Rendering both would
    // let the same follow-up be approved twice into two separate tasks.
    const runs = [run('r2', [action('a2')], 'chat'), run('r1', [action('a1')])];
    expect(liveProposal(runs)?.action.id).toBe('a2');
  });

  it('falls through to an ancestor when the newest turn proposed nothing', () => {
    // Amendment A15: a property_question chat turn proposes no action, but the parent's is live.
    const runs = [run('r2', [], 'chat'), run('r1', [action('a1')])];
    const result = liveProposal(runs);
    expect(result?.action.id).toBe('a1');
    expect(result?.run.id).toBe('r1');
  });

  it('keeps showing an approved action so its confirmation stays visible', () => {
    const result = liveProposal([run('r1', [action('a1', 'approved')])]);
    expect(result?.action.status).toBe('approved');
  });

  it('does not resurrect an older pending action once the newest was approved', () => {
    const runs = [run('r2', [action('a2', 'approved')], 'chat'), run('r1', [action('a1')])];
    expect(liveProposal(runs)?.action.id).toBe('a2');
  });

  it('keeps showing a rejected action rather than reverting to an older one', () => {
    const runs = [run('r2', [action('a2', 'rejected')], 'chat'), run('r1', [action('a1')])];
    expect(liveProposal(runs)?.action.id).toBe('a2');
  });
});
