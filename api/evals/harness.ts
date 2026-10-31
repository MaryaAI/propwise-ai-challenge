import { execSync } from 'node:child_process';
import { join } from 'node:path';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { stableId } from '../src/db/stable-id';

export { stableId };

const PASSWORD = 'challenge123';

/** Resets the shared test database, out-of-process -- same reasoning as test/global-setup.ts. */
export function resetTestDatabase(): void {
  if (!process.env.DATABASE_URL_TEST) {
    throw new Error('DATABASE_URL_TEST is not set. Copy api/.env.example to api/.env.');
  }
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  execSync('pnpm exec tsx src/db/reset.ts', { cwd: join(__dirname, '..'), stdio: 'inherit', env: process.env });
}

export async function createApp(overrideFn?: (builder: TestingModuleBuilder) => TestingModuleBuilder): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (overrideFn) builder = overrideFn(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  await app.listen(0, '127.0.0.1');
  return app;
}

export interface EvalContext {
  app: INestApplication<App>;
  saraToken: string;
  omarToken: string;
  /** Builds a second app instance with a provider override -- only case 6 needs this. */
  createApp: typeof createApp;
}

/**
 * Every run payload a case touched, so a failing case's trace file shows what the API actually
 * returned instead of only the assertion text. `run.ts` starts a fresh recorder before each case,
 * so one case can never pick up another's runs.
 */
export interface RunRecorder {
  runs: unknown[];
}

let currentRecorder: RunRecorder | null = null;

export function startRecording(): RunRecorder {
  currentRecorder = { runs: [] };
  return currentRecorder;
}

function record(label: string, payload: unknown): void {
  currentRecorder?.runs.push({ label, payload });
}

/** Asserts a run completed, surfacing the API's own error text when it did not. */
export function assertCompleted(run: { status: string; error?: string | null; summary?: string; requirements?: unknown }): void {
  assert.strictEqual(
    run.status,
    'completed',
    `expected a completed run, got ${run.status}: ${JSON.stringify({ error: run.error, summary: run.summary, requirements: run.requirements })}`,
  );
}

/** The mirror of `assertCompleted`, for the one case that deliberately expects a failed run. */
export function assertFailed(run: { status: string; error?: string | null }): void {
  assert.strictEqual(run.status, 'failed', `expected a failed run, got ${run.status}`);
  assert.ok(run.error, 'a failed run must carry an error');
}

export interface EvalCase {
  name: string;
  category: string;
  run(ctx: EvalContext): Promise<{ trace: unknown }>;
}

/** Low-level escape hatch for cases that need to assert a non-2xx status themselves. */
export function httpRequest(app: INestApplication<App>, token: string, method: 'get' | 'post', path: string, body?: object) {
  const req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}

export async function login(app: INestApplication<App>, email: string): Promise<string> {
  const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password: PASSWORD });
  assert.strictEqual(response.status, 200, `login(${email}) failed: ${JSON.stringify(response.body)}`);
  return response.body.accessToken;
}

export async function getLead(app: INestApplication<App>, token: string, leadId: string) {
  const response = await httpRequest(app, token, 'get', `/leads/${leadId}`);
  assert.strictEqual(response.status, 200, `getLead failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function listTasks(app: INestApplication<App>, token: string, leadId: string): Promise<unknown[]> {
  const response = await httpRequest(app, token, 'get', `/leads/${leadId}/tasks`);
  assert.strictEqual(response.status, 200, `listTasks failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function getProperty(app: INestApplication<App>, token: string, propertyId: string) {
  const response = await httpRequest(app, token, 'get', `/properties/${propertyId}`);
  assert.strictEqual(response.status, 200, `getProperty failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function addMessage(
  app: INestApplication<App>,
  token: string,
  leadId: string,
  message: { direction: 'inbound' | 'outbound'; channel: 'whatsapp' | 'email' | 'sms'; body: string; sentAt?: string },
) {
  const response = await httpRequest(app, token, 'post', `/leads/${leadId}/messages`, message);
  assert.strictEqual(response.status, 201, `addMessage failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function createRun(app: INestApplication<App>, token: string, leadId: string, messageId?: string) {
  const response = await httpRequest(app, token, 'post', `/leads/${leadId}/assistant/runs`, messageId ? { messageId } : {});
  // Record before asserting: a non-201 body is the most interesting one to keep.
  record(`createRun(${leadId})`, response.body);
  assert.strictEqual(response.status, 201, `createRun failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function getRun(app: INestApplication<App>, token: string, leadId: string, runId: string) {
  const response = await httpRequest(app, token, 'get', `/leads/${leadId}/assistant/runs/${runId}`);
  record(`getRun(${runId})`, response.body);
  assert.strictEqual(response.status, 200, `getRun failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

/** A follow-up chat turn on an existing run. Returns the NEW run it creates. */
export async function sendChatMessage(app: INestApplication<App>, token: string, leadId: string, runId: string, content: string) {
  const response = await httpRequest(app, token, 'post', `/leads/${leadId}/assistant/runs/${runId}/messages`, { content });
  record(`chat(${runId})`, response.body);
  assert.strictEqual(response.status, 201, `sendChatMessage failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function listRuns(app: INestApplication<App>, token: string, leadId: string, limit?: number) {
  const path = limit === undefined ? `/leads/${leadId}/assistant/runs` : `/leads/${leadId}/assistant/runs?limit=${limit}`;
  const response = await httpRequest(app, token, 'get', path);
  assert.strictEqual(response.status, 200, `listRuns failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

/**
 * The lead's oldest inbound seed message. Cases pin this explicitly rather than relying on the
 * "latest inbound" default, which case 4 changes for Karim by appending a message mid-suite.
 */
export async function seedRequirementsMessageId(app: INestApplication<App>, token: string, leadId: string): Promise<string> {
  const lead = await getLead(app, token, leadId);
  const inbound = (lead.messages as { id: string; direction: string; sentAt: string }[])
    .filter((m) => m.direction === 'inbound')
    .sort((a, b) => (a.sentAt === b.sentAt ? a.id.localeCompare(b.id) : a.sentAt.localeCompare(b.sentAt)));
  assert.ok(inbound.length > 0, `lead ${leadId} has no inbound message`);
  return inbound[0].id;
}

export async function approve(app: INestApplication<App>, token: string, leadId: string, runId: string, actionId: string) {
  const response = await httpRequest(app, token, 'post', `/leads/${leadId}/assistant/runs/${runId}/actions/${actionId}/approve`);
  assert.strictEqual(response.status, 200, `approve failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function reject(app: INestApplication<App>, token: string, leadId: string, runId: string, actionId: string) {
  const response = await httpRequest(app, token, 'post', `/leads/${leadId}/assistant/runs/${runId}/actions/${actionId}/reject`);
  assert.strictEqual(response.status, 200, `reject failed: ${JSON.stringify(response.body)}`);
  return response.body;
}
