import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

/**
 * A non-chat companion to `7b-tool-choice-chat`, which is architecture section 13's actual case 7.
 * This one checks only the positive claim: asked for a shortlist, the agent reaches for the search
 * tool and passes the requirements through as filters.
 *
 * It deliberately does NOT assert that `get_property` is absent. It did while it was Phase 5's
 * stand-in for the real case 7, and that assertion was wrong: a real run searched and then called
 * `get_property` on MBR-1022 to read its full record before writing a reason, which is precisely
 * what the system prompt's "never state a price, yield or status you did not read from a tool"
 * asks for. Nothing in TASK.md or the architecture forbids it. The genuine tool-choice
 * discrimination -- a question about one listing must NOT trigger a search -- lives in
 * `7b-tool-choice-chat`, where the spec puts it.
 */
export const case7ToolChoice: EvalCase = {
  name: '7-tool-choice-without-chat',
  category: 'tool-choice',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);
    assertCompleted(run);

    const entries = run.trace as { tool: string; input?: unknown }[];
    const search = entries.find((entry) => entry.tool === 'search_properties');
    assert.ok(search, `expected search_properties to be called, got ${JSON.stringify(entries.map((e) => e.tool))}`);

    // The requirements must actually reach the tool as filters, rather than the agent searching
    // blind and filtering in its head.
    const input = search.input as { areas?: string[]; bedroomsMin?: number; bedroomsMax?: number; priceMaxAed?: number };
    assert.deepEqual(input.areas, ['Dubai Marina']);
    assert.strictEqual(input.bedroomsMin, 2);
    assert.strictEqual(input.bedroomsMax, 2);
    // 2,000,000 plus the 5% tolerance "around" implies -- computed in code, handed to the agent.
    assert.strictEqual(input.priceMaxAed, 2_100_000);

    return { trace: run.trace };
  },
};
