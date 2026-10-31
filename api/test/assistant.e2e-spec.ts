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

/**
 * A scripted tool call. Needed whenever a test wants the run to end up with recommendations: the
 * guardrails reject any listing that did not appear in this run's own tool output ('not_seen'), so
 * a model that only emits a final object can never produce a shortlist.
 */
function toolCallResult(toolCallId: string, toolName: string, input: unknown) {
  return {
    content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
    finishReason: { unified: 'tool-calls' as const, raw: undefined },
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

  describe('the follow-up action is decided by the route, not by the model', () => {
    /** Scripts a "search"-routing extraction for Karim, citing real quotes from his seed message. */
    function karimSearchExtraction(messageId: string) {
      return minimalExtraction({
        intent: 'requirements',
        locations: { value: ['Dubai Marina'], evidence: { sourceId: messageId, quote: 'Dubai Marina' }, status: 'stated' },
        bedrooms: {
          value: { min: 2, max: 2 },
          evidence: { sourceId: messageId, quote: '2-bedroom' },
          status: 'stated',
        },
      });
    }

    async function karimInboundMessageId(token: string): Promise<string> {
      const lead = await request(app.getHttpServer()).get(`/leads/${KARIM}`).set('Authorization', `Bearer ${token}`).expect(200);
      return lead.body.messages.find((m: { direction: string }) => m.direction === 'inbound').id;
    }

    it('still proposes one action on the search route when the model returns followUpTask: null', async () => {
      const token = await login('sara@marinabay.test');
      const messageId = await karimInboundMessageId(token);

      scripted.push(
        textResult(karimSearchExtraction(messageId)),
        textResult({ recommendations: [], summary: 'Nothing fits.', reply: 'Nothing fits.', followUpTask: null }),
      );

      const response = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ messageId })
        .expect(201);

      expect(response.body.status).toBe('completed');
      // Proves the search route was actually taken: the summary is the agent's, not a template's,
      // so the action below came from the route decision rather than a template's followUpTask.
      expect(response.body.summary).toBe('Nothing fits.');
      expect(response.body.requirements.locations).toEqual(['Dubai Marina']);
      expect(response.body.proposedActions).toHaveLength(1);
      expect(response.body.proposedActions[0].task.title).toBeTruthy();
    });

    it('uses the model wording for the action when it supplies one', async () => {
      const token = await login('sara@marinabay.test');
      const messageId = await karimInboundMessageId(token);

      scripted.push(
        textResult(karimSearchExtraction(messageId)),
        textResult({
          recommendations: [],
          summary: 'Nothing fits.',
          reply: 'Nothing fits.',
          followUpTask: { title: 'Call Karim about Marina stock', notes: 'He wants a 2-bed.' },
        }),
      );

      const response = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ messageId })
        .expect(201);

      expect(response.body.proposedActions).toHaveLength(1);
      expect(response.body.proposedActions[0].task).toMatchObject({
        title: 'Call Karim about Marina stock',
        notes: 'He wants a 2-bed.',
      });
    });

    it('proposes nothing when the lead closed the conversation', async () => {
      const token = await login('sara@marinabay.test');
      scripted.push(textResult(minimalExtraction({ closed: true })));

      const response = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(201);

      expect(response.body.status).toBe('completed');
      expect(response.body.proposedActions).toEqual([]);
    });
  });

  describe('chat turns on an existing run', () => {
    /** A property_question chat turn makes TWO model calls: the extraction and the agent. */
    function scriptChatTurn() {
      scripted.push(
        textResult(minimalExtraction({ intent: 'property_question' })),
        textResult({ recommendations: [], summary: 'Service charge is 15/sqft.', reply: 'It is 15 AED per sqft.', followUpTask: null }),
      );
    }

    it('creates a NEW run with parentRunId, trigger chat, and the agent message', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);
      scriptChatTurn();

      const response = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'What is the service charge on MBR-1001?' })
        .expect(201);

      expect(response.body.id).not.toBe(runId);
      expect(response.body.parentRunId).toBe(runId);
      expect(response.body.trigger).toBe('chat');
      expect(response.body.agentMessage).toBe('What is the service charge on MBR-1001?');
      expect(response.body.status).toBe('completed');
      // The parent run is never mutated.
      const parent = await request(app.getHttpServer())
        .get(`/leads/${HASSAN}/assistant/runs/${runId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(parent.body.trigger).toBe('analysis');
      expect(parent.body.agentMessage).toBeNull();
    });

    it('creates no Message row on the lead and no task', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);
      const before = await request(app.getHttpServer()).get(`/leads/${HASSAN}`).set('Authorization', `Bearer ${token}`).expect(200);
      const tasksBefore = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);
      scriptChatTurn();

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Anything else in the Marina?' })
        .expect(201);

      const after = await request(app.getHttpServer()).get(`/leads/${HASSAN}`).set('Authorization', `Bearer ${token}`).expect(200);
      const tasksAfter = await request(app.getHttpServer()).get(`/leads/${HASSAN}/tasks`).set('Authorization', `Bearer ${token}`).expect(200);
      expect(after.body.messages.length).toBe(before.body.messages.length);
      expect(tasksAfter.body.length).toBe(tasksBefore.body.length);
    });

    it('reuses the parent run analysed message id', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);
      const parent = await request(app.getHttpServer())
        .get(`/leads/${HASSAN}/assistant/runs/${runId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      scriptChatTurn();

      const response = await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'And the yield?' })
        .expect(201);

      expect(response.body.messageId).toBe(parent.body.messageId);
    });

    it('400s on empty content, and on content over 2000 characters', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: '' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'x'.repeat(2001) })
        .expect(400);
    });

    it('404s when the parent run belongs to a different lead', async () => {
      const token = await login('sara@marinabay.test');
      const { runId } = await createClarifyRun(token);

      await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'hello' })
        .expect(404);
    });

    it("404s on another agency's run", async () => {
      const saraToken = await login('sara@marinabay.test');
      const omarToken = await login('omar@desertkey.test');
      const { runId } = await createClarifyRun(saraToken);

      await request(app.getHttpServer())
        .post(`/leads/${HASSAN}/assistant/runs/${runId}/messages`)
        .set('Authorization', `Bearer ${omarToken}`)
        .send({ content: 'hello' })
        .expect(404);
    });
  });

  describe('a chat turn must not lose what the parent already resolved', () => {
    interface RunBody {
      id: string;
      status: string;
      requirements: { locations: string[] };
      recommendations: { propertyId: string }[];
      proposedActions: { needsClarification: string | null; task: { dueAt: string | null } }[];
    }

    /** Karim's seed message says "follow up with me tomorrow", so the parent resolves a real date. */
    async function karimRunWithDate(token: string): Promise<RunBody> {
      const lead = await request(app.getHttpServer()).get(`/leads/${KARIM}`).set('Authorization', `Bearer ${token}`).expect(200);
      const messageId = lead.body.messages.find((m: { direction: string }) => m.direction === 'inbound').id;

      scripted.push(
        textResult(
          minimalExtraction({
            intent: 'requirements',
            locations: { value: ['Dubai Marina'], evidence: { sourceId: messageId, quote: 'Dubai Marina' }, status: 'stated' },
            followUp: {
              value: { kind: 'tomorrow', weekday: null, days: null, time: null },
              evidence: { sourceId: messageId, quote: 'tomorrow' },
              status: 'stated',
            },
          }),
        ),
        textResult({ recommendations: [], summary: 'Nothing fits.', reply: 'Nothing fits.', followUpTask: null }),
      );

      const run = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ messageId })
        .expect(201);
      expect(run.body.proposedActions[0].task.dueAt).toBeTruthy();
      return run.body;
    }

    it('inherits the resolved date when the turn says nothing about timing', async () => {
      const token = await login('sara@marinabay.test');
      const parent = await karimRunWithDate(token);

      // A narrowing turn: states a budget, says nothing about timing.
      scripted.push(
        textResult(minimalExtraction({ intent: 'requirements' })),
        textResult({ recommendations: [], summary: 'Narrowed.', reply: 'Narrowed.', followUpTask: null }),
      );
      const chat = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs/${parent.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Only show options under 1.9M' })
        .expect(201);

      expect(chat.body.proposedActions).toHaveLength(1);
      // Previously this came back null with "The lead did not say when to follow up."
      expect(chat.body.proposedActions[0].task.dueAt).toBe(parent.proposedActions[0].task.dueAt);
      expect(chat.body.proposedActions[0].needsClarification).toBeNull();
    });

    it('keeps the shortlist on a template-route turn instead of reporting nothing fits', async () => {
      const token = await login('sara@marinabay.test');
      const lead = await request(app.getHttpServer()).get(`/leads/${KARIM}`).set('Authorization', `Bearer ${token}`).expect(200);
      const messageId = lead.body.messages.find((m: { direction: string }) => m.direction === 'inbound').id;
      const marinaProperty = await request(app.getHttpServer())
        .get(`/properties?area=Dubai Marina&status=available`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const pick = marinaProperty.body.items[0];

      scripted.push(
        textResult(
          minimalExtraction({
            intent: 'requirements',
            locations: { value: ['Dubai Marina'], evidence: { sourceId: messageId, quote: 'Dubai Marina' }, status: 'stated' },
          }),
        ),
        // The search has to really happen, or the guardrails reject the pick as 'not_seen'.
        toolCallResult('call-1', 'search_properties', { areas: ['Dubai Marina'], status: 'available' }),
        textResult({
          recommendations: [{ propertyId: pick.id, reason: 'Fits the brief.' }],
          summary: 'One match.',
          reply: 'One match.',
          followUpTask: null,
        }),
      );
      const parent = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .send({ messageId })
        .expect(201);
      expect(parent.body.recommendations).toHaveLength(1);

      // change_follow_up takes the template branch: no agent call, so only ONE scripted response.
      scripted.push(textResult(minimalExtraction({ intent: 'change_follow_up' })));
      const chat = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs/${parent.body.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'Move the follow-up to Tuesday' })
        .expect(201);

      // Previously []: "nothing fits" for a lead whose listings had not changed.
      expect(chat.body.recommendations).toHaveLength(1);
      expect(chat.body.recommendations[0].propertyId).toBe(pick.id);
      expect(chat.body.summary).not.toMatch(/has been rescheduled/);
    });

    it('recovers state from the last completed ancestor when the parent run failed', async () => {
      const token = await login('sara@marinabay.test');
      const parent = await karimRunWithDate(token);
      expect(parent.requirements.locations).toEqual(['Dubai Marina']);

      // A chat turn whose extraction never validates -> a failed run, persisting no state.
      scripted.push(textResult({ not: 'valid' }), textResult({ still: 'not valid' }));
      const failed = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs/${parent.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'anything' })
        .expect(201);
      expect(failed.body.status).toBe('failed');
      expect(failed.body.requirements.locations).toEqual([]);

      // Retrying on the FAILED run must not lose Karim's requirements.
      scripted.push(
        textResult(minimalExtraction({ intent: 'requirements' })),
        textResult({ recommendations: [], summary: 'ok', reply: 'ok', followUpTask: null }),
      );
      const retry = await request(app.getHttpServer())
        .post(`/leads/${KARIM}/assistant/runs/${failed.body.id}/messages`)
        .set('Authorization', `Bearer ${token}`)
        .send({ content: 'What about the yield?' })
        .expect(201);

      expect(retry.body.status).toBe('completed');
      // Previously [] -- which also disabled the area/bedrooms/type guardrail checks.
      expect(retry.body.requirements.locations).toEqual(['Dubai Marina']);
    });
  });

  describe('GET the run history', () => {
    it('returns items newest first with a total, scoped to the lead', async () => {
      const token = await login('sara@marinabay.test');
      const first = await createClarifyRun(token);
      const second = await createClarifyRun(token);

      const response = await request(app.getHttpServer())
        .get(`/leads/${HASSAN}/assistant/runs`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(typeof response.body.total).toBe('number');
      expect(response.body.items.length).toBeGreaterThanOrEqual(2);
      const ids = response.body.items.map((r: { id: string }) => r.id);
      expect(ids.indexOf(second.runId)).toBeLessThan(ids.indexOf(first.runId));
      // dueAt must carry the agent's +04:00 offset, not the process zone, even under TZ=UTC.
      const withDue = response.body.items.find((r: { proposedActions: { task: { dueAt: string | null } }[] }) => r.proposedActions[0]?.task.dueAt);
      if (withDue) expect(withDue.proposedActions[0].task.dueAt).toContain('+04:00');
    });

    it('honours limit and rejects an out-of-range one', async () => {
      const token = await login('sara@marinabay.test');
      await createClarifyRun(token);
      await createClarifyRun(token);

      const limited = await request(app.getHttpServer())
        .get(`/leads/${HASSAN}/assistant/runs?limit=1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(limited.body.items).toHaveLength(1);

      await request(app.getHttpServer()).get(`/leads/${HASSAN}/assistant/runs?limit=0`).set('Authorization', `Bearer ${token}`).expect(400);
      await request(app.getHttpServer()).get(`/leads/${HASSAN}/assistant/runs?limit=99`).set('Authorization', `Bearer ${token}`).expect(400);
    });

    it("404s on another agency's lead", async () => {
      const token = await login('sara@marinabay.test');
      await request(app.getHttpServer()).get(`/leads/${NADIA}/assistant/runs`).set('Authorization', `Bearer ${token}`).expect(404);
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
