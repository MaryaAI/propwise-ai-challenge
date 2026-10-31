'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type AssistantRun, type LeadDetail } from '@/lib/api';
import { liveProposal } from '@/lib/assistant';
import { useSession } from '@/lib/session';
import { ActionCard } from './ActionCard';
import { RunCard } from './RunCard';

interface Props {
  lead: LeadDetail;
  /** Called after an approval creates a task, so the Tasks list refreshes. */
  onTaskCreated: () => void;
  /** The page's handler: it logs out on a 401, which this panel must not swallow. */
  onError: (error: unknown) => void;
}

/**
 * The AI assistant for one lead. Only ever one proposal is shown -- see `liveProposal` for why
 * that has to be a search over the run chain rather than a read of the newest run.
 */
export function AssistantPanel({ lead, onTaskCreated, onError }: Props) {
  const { session } = useSession();
  const [runs, setRuns] = useState<AssistantRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chat, setChat] = useState('');
  const [chatting, setChatting] = useState(false);

  const token = session?.token;
  const timeZone = session?.agent.timezone ?? 'Asia/Dubai';

  const fail = useCallback(
    (error: unknown) => {
      onError(error);
      setActionError(error instanceof Error ? error.message : 'Something went wrong');
    },
    [onError],
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api
      .listRuns(token, lead.id)
      .then((page) => {
        if (!cancelled) setRuns(page.items);
      })
      .catch(onError)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, lead.id, onError]);

  const hasInbound = lead.messages.some((message) => message.direction === 'inbound');
  const latest = runs[0] ?? null;
  const proposal = liveProposal(runs);
  const conversation = [...runs].reverse().filter((run) => run.agentMessage !== null);

  async function analyze() {
    if (!token) return;
    setAnalyzing(true);
    setActionError(null);
    try {
      const run = await api.createRun(token, lead.id);
      setRuns((current) => [run, ...current]);
    } catch (error) {
      fail(error);
    } finally {
      setAnalyzing(false);
    }
  }

  async function decide(kind: 'approve' | 'reject') {
    if (!token || !proposal) return;
    setDeciding(true);
    setActionError(null);
    try {
      const decided =
        kind === 'approve'
          ? (await api.approveAction(token, lead.id, proposal.run.id, proposal.action.id)).action
          : (await api.rejectAction(token, lead.id, proposal.run.id, proposal.action.id)).action;

      setRuns((current) =>
        current.map((run) =>
          run.id === proposal.run.id
            ? { ...run, proposedActions: run.proposedActions.map((a) => (a.id === decided.id ? decided : a)) }
            : run,
        ),
      );
      if (kind === 'approve') onTaskCreated();
    } catch (error) {
      fail(error);
    } finally {
      setDeciding(false);
    }
  }

  async function send() {
    if (!token || !latest) return;
    const content = chat.trim();
    if (!content) return;
    setChatting(true);
    setActionError(null);
    try {
      const run = await api.sendChatMessage(token, lead.id, latest.id, content);
      setRuns((current) => [run, ...current]);
      setChat('');
    } catch (error) {
      fail(error);
    } finally {
      setChatting(false);
    }
  }

  return (
    <section className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
      <h2 className="font-semibold">AI assistant</h2>

      {loading ? (
        <p className="mt-1 text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="mt-3 space-y-3">
          {latest ? (
            <RunCard run={latest} />
          ) : (
            <p className="text-sm text-gray-500">No analysis yet.</p>
          )}

          {proposal && (
            <ActionCard
              action={proposal.action}
              timeZone={timeZone}
              onApprove={() => decide('approve')}
              onReject={() => decide('reject')}
              pending={deciding}
              error={actionError}
            />
          )}
          {!proposal && actionError && <p className="text-sm text-red-600">{actionError}</p>}

          <button
            type="button"
            onClick={analyze}
            disabled={analyzing || !hasInbound}
            title={hasInbound ? undefined : 'This lead has not sent a message yet'}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
          >
            {analyzing ? 'Analyzing…' : latest ? 'Analyze again' : 'Analyze latest message'}
          </button>

          {conversation.length > 0 && (
            <ol className="space-y-2 border-t border-gray-200 pt-3">
              {conversation.map((run) => (
                <li key={run.id}>
                  <p className="text-sm font-medium">{run.agentMessage}</p>
                  <p className="mt-0.5 text-sm text-gray-700">{run.reply || run.summary}</p>
                </li>
              ))}
            </ol>
          )}

          {latest && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
              className="flex gap-2 border-t border-gray-200 pt-3"
            >
              <input
                value={chat}
                onChange={(event) => setChat(event.target.value)}
                placeholder="Ask a follow-up…"
                maxLength={2000}
                aria-label="Ask the assistant a follow-up"
                className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={chatting || chat.trim() === ''}
                className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40"
              >
                {chatting ? 'Sending…' : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
