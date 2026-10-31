import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ProposedAction } from '../lib/api';
import { formatDateTime } from '../lib/format';

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
 * The follow-up the assistant drafted. Nothing is saved until Approve is pressed. Once decided the
 * buttons go away, so a second approval cannot look like it made a second task.
 */
export function ActionCard({ action, timeZone, onApprove, onReject, pending, error }: Props) {
  const decided = action.status !== 'pending_approval';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{action.task.title}</Text>
      <Text style={styles.meta}>
        {action.task.dueAt ? `Due ${formatDateTime(action.task.dueAt, timeZone)}` : 'No due date'}
        {action.task.notes ? ` · ${action.task.notes}` : ''}
      </Text>

      {action.needsClarification && <Text style={styles.clarify}>{action.needsClarification}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      {decided ? (
        <Text style={styles.decided}>{DECIDED[action.status as 'approved' | 'rejected']}</Text>
      ) : (
        <View style={styles.buttons}>
          <Pressable style={styles.approve} onPress={onApprove} disabled={pending} accessibilityRole="button">
            {pending ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.approveText}>Approve</Text>}
          </Pressable>
          <Pressable style={styles.reject} onPress={onReject} disabled={pending} accessibilityRole="button">
            <Text style={styles.rejectText}>Reject</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, backgroundColor: '#f6f7f9', borderWidth: 1, borderColor: '#e5e7eb', padding: 12, gap: 4 },
  title: { color: '#111827', fontWeight: '500' },
  meta: { color: '#6b7280', fontSize: 12 },
  clarify: { color: '#b45309', fontSize: 12, marginTop: 4 },
  error: { color: '#dc2626', fontSize: 13, marginTop: 4 },
  decided: { color: '#6b7280', fontSize: 12, marginTop: 4 },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 8 },
  approve: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  approveText: { color: '#ffffff', fontWeight: '500' },
  reject: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  rejectText: { color: '#111827' },
});
