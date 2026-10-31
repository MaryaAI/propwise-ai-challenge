'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AppHeader } from '@/components/AppHeader';
import { AssistantPanel } from '@/components/AssistantPanel';
import { MessageThread } from '@/components/MessageThread';
import { StatusBadge } from '@/components/StatusBadge';
import { TaskList } from '@/components/TaskList';
import { api, ApiError, LeadDetail, Page, Task } from '@/lib/api';
import { useRequiredSession, useSession } from '@/lib/session';

export default function LeadPage() {
  const { id } = useParams<{ id: string }>();
  const session = useRequiredSession();
  const { logout } = useSession();
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

  const loadTasks = useCallback(async () => {
    if (!session) return;
    setTasks(await api.listTasks(session.token, id));
  }, [session, id]);

  useEffect(() => {
    if (!session) return;
    Promise.all([api.getLead(session.token, id), api.listTasks(session.token, id)])
      .then(([leadResult, taskResult]) => {
        setLead(leadResult);
        setTasks(taskResult);
      })
      .catch(handleError);
  }, [session, id, handleError]);

  async function toggleTask(task: Task) {
    if (!session) return;
    try {
      await api.updateTask(session.token, task.id, { status: task.status === 'done' ? 'open' : 'done' });
      await loadTasks();
    } catch (err) {
      handleError(err);
    }
  }

  if (!session) return null;
  const timeZone = session.agent.timezone;

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Link href="/leads" className="text-sm text-gray-500 hover:underline">
          ← All leads
        </Link>
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        {!lead && !error && <p className="mt-4 text-sm text-gray-500">Loading…</p>}
        {lead && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {[lead.phone, lead.email, `via ${lead.source}`].filter(Boolean).join(' · ')}
            </p>
            {lead.notes && <p className="mt-2 text-sm text-gray-600">{lead.notes}</p>}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
              <section className="rounded-xl bg-gray-50 p-4 ring-1 ring-gray-200">
                <h2 className="mb-3 font-semibold">Conversation</h2>
                <MessageThread messages={lead.messages} timeZone={timeZone} />
              </section>
              <div className="space-y-6">
                <AssistantPanel lead={lead} onTaskCreated={loadTasks} onError={handleError} />
                <section className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
                  <h2 className="mb-3 font-semibold">Tasks</h2>
                  <TaskList tasks={tasks.items} total={tasks.total} timeZone={timeZone} onToggle={toggleTask} />
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
