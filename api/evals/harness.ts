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
  assert.strictEqual(response.status, 201, `createRun failed: ${JSON.stringify(response.body)}`);
  return response.body;
}

export async function getRun(app: INestApplication<App>, token: string, leadId: string, runId: string) {
  const response = await httpRequest(app, token, 'get', `/leads/${leadId}/assistant/runs/${runId}`);
  assert.strictEqual(response.status, 200, `getRun failed: ${JSON.stringify(response.body)}`);
  return response.body;
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
