import { fireEvent, render, screen } from '@testing-library/react';
import type { ProposedAction } from '@/lib/api';
import { ActionCard } from './ActionCard';

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    id: 'action-1',
    type: 'create_follow_up_task',
    status: 'pending_approval',
    task: { title: 'Follow up with Karim Mansour', notes: null, dueAt: null },
    needsClarification: null,
    ...overrides,
  };
}

const noop = () => undefined;

describe('ActionCard', () => {
  it("shows the due time in the agent's timezone", () => {
    // The API sends the agent's own offset; 10:00 +04:00 must not be re-shifted.
    render(
      <ActionCard
        action={action({ task: { title: 'Call Karim', notes: null, dueAt: '2026-11-01T10:00:00+04:00' } })}
        timeZone="Asia/Dubai"
        onApprove={noop}
        onReject={noop}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText(/Due 1 Nov, 10:00/)).toBeInTheDocument();
  });

  it('says when there is no due date', () => {
    render(<ActionCard action={action()} timeZone="Asia/Dubai" onApprove={noop} onReject={noop} pending={false} error={null} />);
    expect(screen.getByText(/No due date/)).toBeInTheDocument();
  });

  it('explains an unclear date instead of inventing one', () => {
    render(
      <ActionCard
        action={action({ needsClarification: 'The lead said "sometime next week".' })}
        timeZone="Asia/Dubai"
        onApprove={noop}
        onReject={noop}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText('The lead said "sometime next week".')).toBeInTheDocument();
  });

  it('approves and rejects through its callbacks', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <ActionCard action={action()} timeZone="Asia/Dubai" onApprove={onApprove} onReject={onReject} pending={false} error={null} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('offers no buttons once the action was approved', () => {
    render(
      <ActionCard action={action({ status: 'approved' })} timeZone="Asia/Dubai" onApprove={noop} onReject={noop} pending={false} error={null} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });

  it('offers no buttons once the action was rejected, and says nothing was saved', () => {
    render(
      <ActionCard action={action({ status: 'rejected' })} timeZone="Asia/Dubai" onApprove={noop} onReject={noop} pending={false} error={null} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing was saved/)).toBeInTheDocument();
  });

  it('disables both buttons while a decision is in flight', () => {
    render(<ActionCard action={action()} timeZone="Asia/Dubai" onApprove={noop} onReject={noop} pending error={null} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it("shows the API's conflict message", () => {
    render(
      <ActionCard
        action={action()}
        timeZone="Asia/Dubai"
        onApprove={noop}
        onReject={noop}
        pending={false}
        error="This action was already rejected"
      />,
    );
    expect(screen.getByText('This action was already rejected')).toBeInTheDocument();
  });
});
