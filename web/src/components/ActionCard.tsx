import type { ProposedAction } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

interface Props {
  action: ProposedAction;
  timeZone: string;
  onApprove: () => void;
  onReject: () => void;
  /** True while an approve or reject is in flight. */
  pending: boolean;
  error: string | null;
}

const DECIDED: Record<'approved' | 'rejected', string> = {
  approved: 'Approved — the task is in the list below.',
  rejected: 'Rejected. Nothing was saved.',
};

/**
 * The follow-up the assistant drafted. Nothing is saved until Approve is pressed, so this card is
 * the only path to a task. Once decided, the buttons go away: approving twice is harmless on the
 * API (it returns the same task) but hiding them keeps that from looking like a second task.
 */
export function ActionCard({ action, timeZone, onApprove, onReject, pending, error }: Props) {
  const decided = action.status !== 'pending_approval';

  return (
    <div className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-200">
      <p className="text-sm font-medium">{action.task.title}</p>
      <p className="mt-0.5 text-xs text-gray-500">
        {action.task.dueAt ? `Due ${formatDateTime(action.task.dueAt, timeZone)}` : 'No due date'}
        {action.task.notes ? ` · ${action.task.notes}` : ''}
      </p>

      {action.needsClarification && <p className="mt-2 text-xs text-amber-700">{action.needsClarification}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {decided ? (
        <p className="mt-2 text-xs text-gray-500">{DECIDED[action.status as 'approved' | 'rejected']}</p>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={pending}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {pending ? 'Working…' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={onReject}
            disabled={pending}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}
