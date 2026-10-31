// Types mirror the API's response shapes in api/src/common/dto.ts.

export interface Agent {
  id: string;
  name: string;
  email: string;
  timezone: string;
  agency: { id: string; name: string };
}

export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: string;
  leadId: string;
  direction: MessageDirection;
  channel: 'whatsapp' | 'email' | 'sms';
  body: string;
  sentAt: string;
}

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'viewing' | 'negotiating' | 'won' | 'lost';

export interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: 'whatsapp' | 'website' | 'portal' | 'referral' | 'email';
  status: LeadStatus;
  notes: string | null;
  assignedAgent: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadSummary extends Lead {
  lastMessage: Message | null;
}

export interface LeadDetail extends Lead {
  /** The newest messages (up to 200), oldest first. */
  messages: Message[];
  messageCount: number;
}

export interface Property {
  id: string;
  reference: string;
  title: string;
  area: string;
  building: string | null;
  type: 'apartment' | 'villa' | 'townhouse' | 'penthouse';
  bedrooms: number;
  bathrooms: number;
  sizeSqft: number;
  priceAed: number;
  annualRentAed: number | null;
  serviceChargeAedPerSqft: number | null;
  status: 'available' | 'reserved' | 'sold';
  description: string;
  listedAt: string;
}

export interface Task {
  id: string;
  leadId: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: 'open' | 'done';
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** What the assistant understood from the conversation. `bedrooms: 0` is a studio. */
export interface AssistantRequirements {
  locations: string[];
  bedrooms: number | null;
  budgetAed: { min: number | null; max: number | null };
  propertyType: 'apartment' | 'villa' | 'townhouse' | 'penthouse' | null;
  intent: 'buy' | 'rent' | 'unknown';
  preferences: string[];
}

export interface Recommendation {
  propertyId: string;
  reason: string;
  /** A snapshot taken when the run was saved, so the panel needs no second request. */
  property: {
    reference: string;
    title: string;
    area: string;
    bedrooms: number;
    priceAed: number;
    annualRentAed: number | null;
    /** Null when the listing has no known rent. */
    grossYield: number | null;
    status: string;
  };
}

export interface ProposedAction {
  id: string;
  type: 'create_follow_up_task';
  status: 'pending_approval' | 'approved' | 'rejected';
  task: {
    title: string;
    notes: string | null;
    /** ISO 8601 with the agent's offset, e.g. "2026-11-01T10:00:00+04:00". */
    dueAt: string | null;
  };
  needsClarification: string | null;
}

export interface TraceEntry {
  tool: string;
  input: unknown;
  /** Present on a call that succeeded (null if the tool returned nothing). */
  output?: unknown;
  /** Present instead of `output` on a call that failed. */
  error?: string;
  durationMs: number;
}

export interface AssistantRun {
  id: string;
  leadId: string;
  messageId: string;
  status: 'completed' | 'failed';
  /** Absent rather than null when the run succeeded. */
  error?: string;
  requirements: AssistantRequirements;
  recommendations: Recommendation[];
  /** What the agent should know. Always a string. */
  summary: string;
  proposedActions: ProposedAction[];
  trace: TraceEntry[];
  createdAt: string;
  parentRunId: string | null;
  trigger: 'analysis' | 'chat';
  /** What the agent typed, on a chat turn. */
  agentMessage: string | null;
  /** The conversational text, as opposed to `summary`. Always a string. */
  reply: string;
}

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(response.status, message ?? `Request failed with ${response.status}`);
  }
  return response;
}

async function request<T>(path: string, token: string | null, init: RequestInit = {}): Promise<T> {
  return (await (await send(path, token, init)).json()) as T;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; agent: Agent }>('/auth/login', null, {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  listLeads: (token: string, params: { limit: number; offset: number }) =>
    request<Page<LeadSummary>>(`/leads?limit=${params.limit}&offset=${params.offset}`, token),
  getLead: (token: string, leadId: string) => request<LeadDetail>(`/leads/${leadId}`, token),
  /** Up to 100 tasks; the API sends the total in the X-Total-Count header. */
  listTasks: async (token: string, leadId: string): Promise<Page<Task>> => {
    const response = await send(`/leads/${leadId}/tasks`, token);
    const items = (await response.json()) as Task[];
    return { items, total: Number(response.headers.get('X-Total-Count') ?? items.length) };
  },
  updateTask: (token: string, taskId: string, changes: Partial<Pick<Task, 'status'>>) =>
    request<Task>(`/tasks/${taskId}`, token, { method: 'PATCH', body: JSON.stringify(changes) }),
  getProperty: (token: string, propertyId: string) => request<Property>(`/properties/${propertyId}`, token),

  /** Analyses a lead's message. Defaults to their latest inbound one. Can take up to 100 seconds. */
  createRun: (token: string, leadId: string, messageId?: string) =>
    request<AssistantRun>(`/leads/${leadId}/assistant/runs`, token, {
      method: 'POST',
      body: JSON.stringify(messageId ? { messageId } : {}),
    }),
  getRun: (token: string, leadId: string, runId: string) =>
    request<AssistantRun>(`/leads/${leadId}/assistant/runs/${runId}`, token),
  /** Newest first. */
  listRuns: (token: string, leadId: string, limit = 20) =>
    request<Page<AssistantRun>>(`/leads/${leadId}/assistant/runs?limit=${limit}`, token),
  /** A follow-up turn. Returns a NEW run whose parentRunId is the one passed in. */
  sendChatMessage: (token: string, leadId: string, runId: string, content: string) =>
    request<AssistantRun>(`/leads/${leadId}/assistant/runs/${runId}/messages`, token, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** The only path that creates a task. Approving twice returns the same task. */
  approveAction: (token: string, leadId: string, runId: string, actionId: string) =>
    request<{ action: ProposedAction; task: Task }>(
      `/leads/${leadId}/assistant/runs/${runId}/actions/${actionId}/approve`,
      token,
      { method: 'POST' },
    ),
  rejectAction: (token: string, leadId: string, runId: string, actionId: string) =>
    request<{ action: ProposedAction }>(`/leads/${leadId}/assistant/runs/${runId}/actions/${actionId}/reject`, token, {
      method: 'POST',
    }),
};
