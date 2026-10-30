import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, stableId } from '../harness';

/**
 * Not in architecture's table -- its case 7 ("choosing the right tool") is chat-only and deferred
 * to Phase 6. This is a documented, additive substitute that proves the same tool-selection
 * behaviour without chat: an `'analysis'`-triggered `'search'` route should call the search tool,
 * not the single-property lookup tool.
 */
export const case7ToolChoice: EvalCase = {
  name: '7-tool-choice-without-chat',
  category: 'tool-choice',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const run = await createRun(app, saraToken, leadId, messageId);
    assertCompleted(run);

    const tools = (run.trace as { tool: string }[]).map((entry) => entry.tool);
    assert.ok(tools.includes('search_properties'), 'expected search_properties to be called');
    assert.ok(!tools.includes('get_property'), 'did not expect get_property to be called for a plain analysis run');

    return { trace: run.trace };
  },
};
