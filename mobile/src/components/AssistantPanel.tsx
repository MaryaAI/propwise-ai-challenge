import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type AssistantRun, type LeadDetail } from '../lib/api';
import { liveProposal } from '../lib/assistant';
import { useSession } from '../lib/session';
import { ActionCard } from './ActionCard';
import { RunCard } from './RunCard';

interface Props {
  lead: LeadDetail;
  /** Called after an approval creates a task, so the Tasks list refreshes. */
  onTaskCreated: () => void;
  /** The screen's handler: it logs out on a 401, which this card must not swallow. */
  onError: (error: unknown) => void;
}

/**
 * The AI assistant for one lead. Same result and the same Approve/Reject as the web panel; chat is
 * web-only (PLAN.md's cut line puts mobile chat first to drop). Only ever one proposal is shown --
 * see `liveProposal` for why that has to be a search over the run chain.
 */
export function AssistantPanel({ lead, onTaskCreated, onError }: Props) {
  const { session } = useSession();
  const [runs, setRuns] = useState<AssistantRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  return (
    <View style={styles.card}>
      <Text style={styles.title}>AI assistant</Text>

      {loading ? (
        <ActivityIndicator />
      ) : (
        <View style={styles.body}>
          {latest ? <RunCard run={latest} /> : <Text style={styles.empty}>No analysis yet.</Text>}

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
          {!proposal && actionError && <Text style={styles.error}>{actionError}</Text>}

          <Pressable
            style={[styles.button, !hasInbound && styles.buttonDisabled]}
            onPress={analyze}
            disabled={analyzing || !hasInbound}
            accessibilityRole="button"
          >
            {analyzing ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.buttonText}>{latest ? 'Analyze again' : 'Analyze latest message'}</Text>
            )}
          </Pressable>
          {!hasInbound && <Text style={styles.empty}>This lead has not sent a message yet.</Text>}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, backgroundColor: '#ffffff', padding: 16, gap: 10 },
  title: { fontWeight: '600', fontSize: 16, color: '#111827' },
  body: { gap: 10 },
  empty: { color: '#6b7280', fontSize: 13 },
  error: { color: '#dc2626', fontSize: 13 },
  button: { backgroundColor: '#111827', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#9ca3af' },
  buttonText: { color: '#ffffff', fontWeight: '500' },
});
