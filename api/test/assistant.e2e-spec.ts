import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { MockLanguageModelV3 } from 'ai/test';
import { AppModule } from '../src/app.module';
import { ASSISTANT_MODEL_FACTORY } from '../src/assistant/model';
import { stableId } from '../src/db/stable-id';

function usage() {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: usage(),
    warnings: [],
  };
}

const MISSING_FIELD = { value: null, evidence: { sourceId: '', quote: '' }, status: 'missing' as const };

function minimalExtraction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    intent: 'other',
    closed: false,
    locations: MISSING_FIELD,
    bedrooms: MISSING_FIELD,
    budget: MISSING_FIELD,
    propertyType: MISSING_FIELD,
    transaction: MISSING_FIELD,
    preferences: [],
    followUp: MISSING_FIELD,
    propertyRefs: [],
    ...overrides,
  };
}

describe('Assistant routes (against the test database, mocked model)', () => {
  let app: INestApplication<App>;
  let scripted: unknown[] = [];

  const HASSAN = stableId('lead', 'hassan');
  const KARIM = stableId('lead', 'karim');
  const NADIA = stableId('lead', 'nadia');

  beforeAll(async () => {
    const mockModel = new MockLanguageModelV3({
      doGenerate: (async () => {
        const next = scripted.shift();
        if (!next) throw new Error('test did not script enough model responses');
        return next;
      }) as never,
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ASSISTANT_MODEL_FACTORY)
      .useValue(() => mockModel)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    scripted = [];
  });

  async function login(email: string): Promise<string> {
    const response = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'challenge123' }).expect(200);
    return response.body.accessToken;
  }

  /** Scripts one "clarify"-routing extraction (no model call for stage 5) and creates a run for Hassan. */
  async function createClarifyRun(token: string): Promise<{ runId: string; actionId: string }> {
    scripted.push(textResult(minimalExtraction()));
    const response = await request(app.getHttpServer())
      .post(`/leads/${HASSAN}/assistant/runs`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(response.body.proposedActions).toHaveLength(1);
    return { runId: response.body.id, actionId: response.body.proposedActions[0].id };
  }

  describe('validation and ownership (no model call reached)', () => {
    let saraToken: string;
    beforeAll(async () => {
      saraToken = await login('sara@marinabay.test');
    });

    it('400s on a malformed leadId', async () => {
      await request(app.getHttpServer())
        .post('/leads/not-a-uuid/assistant/runs')
        .set('Authorization', `Bearer ${saraToken}`)
        .send({})
        .expect(400);
    });

    it('400s on a malformed messageId in the body', async () => {
      await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${saraToken}`)
        .send({ messageId: 'not-a-uuid' })
        .expect(400);
    });

    it('400s on an unknown body field', async () => {
      await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${saraToken}`)
        .send({ somethingElse: true })
        .expect(400);
    });

    it("404s on another agency's lead", async () => {
      await request(app.getHttpServer()).post(`/leads/${NADIA}/assistant/runs`).set('Authorization', `Bearer ${saraToken}`).send({}).expect(404);
    });

    it('404s when messageId does not belong to this lead', async () => {
      const karimMessage = await request(app.getHttpServer())
        .get(`/leads/${KARIM}`)
        .set('Authorization', `Bearer ${saraToken}`)
        .expect(200);
      const karimMessageId = karimMessage.body.messages[0].id;

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs`)
        .set('Authorization', `Bearer ${saraToken}`)
        .send({ messageId: karimMessageId })
        .expect(404);
    });

    it('422s on a lead with zero inbound messages', async () => {
      const lead = await request(app.getHttpServer())
        .post('/leads')
        .set('Authorization', `Bearer ${saraToken}`)
        .send({ name: 'No Messages Yet', source: 'whatsapp' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/leads/${lead.body.id}/assistant/runs`)
        .set('Authorization', `Bearer ${saraToken}`)
        .send({})
        .expect(422);
    });

    it('404s when a run id does not match (id, leadId, agencyId)', async () => {
      const { runId } = await createClarifyRun(saraToken);
      // Correct run, wrong lead in the path.
      await request(app.getHttpServer())
        .get(`/leads/${KARIM}/assistant/runs/${runId}`)
        .set('Authorization', `Bearer ${saraToken}`)
        .expect(404);
    });

    it('404s when an action id does not match (id, runId)', async () => {
      const first = await createClarifyRun(saraToken);
      const second = await createClarifyRun(saraToken);
      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${second.runId}/actions/${first.actionId}/approve`)
        .set('Authorization', `Bearer ${saraToken}`)
        .expect(404);
    });
  });

  describe('a successful run', () => {
    it('is retrievable via GET and matches what POST returned', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);

      const response = await request(app.getHttpServer())
        .get(`/leads/${HASSAN}/assistant/runs/${runId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(response.body.id).toBe(runId);
      expect(response.body.status).toBe('completed');
    });

    it('touches no existing task and does not bump lead.updatedAt', async () => {
      const token = await login('sara@marinabay.test');
      const before = await request(app.getHttpServer()).get(`/leads/${HASSAN}`).set('Authorization', `Bearer ${token}`).expect(200);
      const tasksBefore = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);

      await createClarifyRun(token);

      const after = await request(app.getHttpServer()).get(`/leads/${HASSAN}`).set('Authorization', `Bearer ${token}`).expect(200);
      const tasksAfter = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);

      expect(after.body.updatedAt).toBe(before.body.updatedAt);
      expect(tasksAfter.body.length).toBe(tasksBefore.body.length);
    });
  });

  describe('approve / reject', () => {
    it('approving twice returns the same task id and creates only one task', async () => {
      const token = await login('sara@marinabay.test');
      const { runId, actionId } = await createClarifyRun(token);
      const tasksBefore = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);

      const first = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(second.body.task.id).toBe(first.body.task.id);
      const tasksAfter = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(tasksAfter.body.length).toBe(tasksBefore.body.length + 1);
    });

    it('concurrent approve calls on the same action still create exactly one task', async () => {
      const token = await login('sara@marinabay.test');
      const { runId, actionId } = await createClarifyRun(token);
      const tasksBefore = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);

      const approve = () =>
        request(app.getHttpServer())
          .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/approve`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      const [first, second] = await Promise.all([approve(), approve()]);

      expect(second.body.task.id).toBe(first.body.task.id);
      const tasksAfter = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(tasksAfter.body.length).toBe(tasksBefore.body.length + 1);
    });

    it('approve on a rejected action is 409; reject on a rejected action is 200', async () => {
      const token = await login('sara@marinabay.test');
      const { runId, actionId } = await createClarifyRun(token);

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('reject on an approved action is 409', async () => {
      const token = await login('sara@marinabay.test');
      const { runId, actionId } = await createClarifyRun(token);

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/actions/${actionId}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });
  });

  describe('failure handling', () => {
    it('a model that never produces a valid extraction yields the literal failed-run shape', async () => {
      scripted.push(textResult({ not: 'valid' }), textResult({ still: 'not valid' }));
      const token = await login('sara@marinabay.test');

      const response = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      expect(response.body).toMatchObject({
        status: 'failed',
        recommendations: [],
        proposedActions: [],
        requirements: {
          locations: [],
          bedrooms: null,
          budgetAed: { min: null, max: null },
          propertyType: null,
          intent: 'unknown',
          preferences: [],
        },
      });
      expect(response.body.error).toBeTruthy();
    });
  });
});
