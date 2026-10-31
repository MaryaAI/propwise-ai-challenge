import assert from 'node:assert/strict';
import { assertCompleted, createRun, EvalCase, seedRequirementsMessageId, sendChatMessage, stableId } from '../harness';

/**
 * Architecture section 13's case 7 in its intended chat form, owed since Phase 5 (which could only
 * substitute the non-chat `7-tool-choice-without-chat`). A question about one listing must be
 * answered by looking that listing up -- not by running a fresh search.
 */
export const case7bToolChoiceChat: EvalCase = {
  name: '7b-tool-choice-chat',
  category: 'tool-choice',
  async run({ app, saraToken }) {
    const leadId = stableId('lead', 'karim');
    const messageId = await seedRequirementsMessageId(app, saraToken, leadId);
    const parent = await createRun(app, saraToken, leadId, messageId);
    assertCompleted(parent);

    const chat = await sendChatMessage(app, saraToken, leadId, parent.id, "What's the service charge on MBR-1001?");
    assertCompleted(chat);

    assert.strictEqual(chat.trigger, 'chat');
    assert.strictEqual(chat.parentRunId, parent.id);

    const tools = (chat.trace as { tool: string; input?: unknown }[]).map((entry) => entry.tool);
    assert.ok(tools.includes('get_property'), `expected get_property, got ${JSON.stringify(tools)}`);
    assert.ok(!tools.includes('search_properties'), `a property question must not trigger a new search, got ${JSON.stringify(tools)}`);

    // The lookup must be for MBR-1001 specifically, not just any property.
    const lookedUp = (chat.trace as { tool: string; input?: unknown }[])
      .filter((entry) => entry.tool === 'get_property')
      .map((entry) => JSON.stringify(entry.input));
    assert.ok(
      lookedUp.some((input) => input.includes('MBR-1001') || input.includes(stableId('property', 'MBR-1001'))),
      `expected a get_property call for MBR-1001, got ${JSON.stringify(lookedUp)}`,
    );

    return { trace: chat.trace };
  },
};
