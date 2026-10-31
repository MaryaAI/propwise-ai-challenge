import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AssistantPanel } from '../../components/AssistantPanel';
import { MessageThread } from '../../components/MessageThread';
import { StatusBadge } from '../../components/StatusBadge';
import { TaskList } from '../../components/TaskList';
import { api, ApiError, LeadDetail, Page, Task } from '../../lib/api';
import { useSession } from '../../lib/session';

export default function LeadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, logout } = useSession();
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [tasks, setTasks] = useState<Page<Task>>({ items: [], total: 0 });
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return logout();
      setError(err instanceof Error ? err.message : 'Something went wrong');
    },
    [logout],
  );

  useEffect(() => {
    if (!session) return;
    Promise.all([api.getLead(session.token, id), api.listTasks(session.token, id)])
      .then(([leadResult, taskResult]) => {
        setLead(leadResult);
        setTasks(taskResult);
      })
      .catch(handleError);
  }, [session, id, handleError]);

  const loadTasks = useCallback(async () => {
    if (!session) return;
    setTasks(await api.listTasks(session.token, id));
  }, [session, id]);

  async function toggleTask(task: Task) {
    if (!session) return;
    try {
      await api.updateTask(session.token, task.id, { status: task.status === 'done' ? 'open' : 'done' });
      await loadTasks();
    } catch (err) {
      handleError(err);
    }
  }

  if (!session) return <Redirect href="/login" />;
  const timeZone = session.agent.timezone;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: lead?.name ?? 'Lead' }} />
      {error && <Text style={styles.error}>{error}</Text>}
      {!lead && !error && <ActivityIndicator />}
      {lead && (
        <>
          <View style={styles.header}>
            <Text style={styles.name}>{lead.name}</Text>
            <StatusBadge status={lead.status} />
          </View>
          <Text style={styles.meta}>{[lead.phone, lead.email, `via ${lead.source}`].filter(Boolean).join(' · ')}</Text>
          {lead.notes && <Text style={styles.meta}>{lead.notes}</Text>}

          <AssistantPanel lead={lead} onTaskCreated={loadTasks} onError={handleError} />

          <Text style={styles.section}>Conversation</Text>
          <MessageThread messages={lead.messages} timeZone={timeZone} />

          <Text style={styles.section}>Tasks</Text>
          <TaskList tasks={tasks.items} total={tasks.total} timeZone={timeZone} onToggle={toggleTask} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f9' },
  content: { padding: 16, gap: 12, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 20, fontWeight: '600', color: '#111827' },
  meta: { color: '#4b5563' },
  section: { marginTop: 12, fontSize: 16, fontWeight: '600', color: '#111827' },
  error: { color: '#dc2626' },
});
