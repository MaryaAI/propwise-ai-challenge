import { MockLanguageModelV3 } from 'ai/test';
import { Extraction } from './extraction.schema';
import { ExtractionFailedError, Extractor } from './extractor';
import { AGENT_INSTRUCTION_SOURCE_ID, ConversationMessage } from './prompts';

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

const KARIM_MESSAGE: ConversationMessage = {
  id: 'msg-1',
  direction: 'inbound',
  sentAt: '2026-10-30T08:00:00Z',
  body: "Hey, I'm looking for a 2-bedroom apartment in Dubai Marina, budget around 2M AED. Prefer something with a good rental yield. Can you follow up with me tomorrow?",
};

const BASE_INPUT = {
  agencyName: 'Marina Bay Realty',
  areas: ['Dubai Marina', 'Jumeirah Lake Towers'],
  conversation: [KARIM_MESSAGE],
  analysedMessageId: 'msg-1',
};

function karimExtraction(): Extraction {
  return {
    intent: 'requirements',
    closed: false,
    closedEvidence: { sourceId: '', quote: '' },
    locations: { value: ['Dubai Marina'], evidence: { sourceId: 'msg-1', quote: 'Dubai Marina' }, status: 'stated' },
    bedrooms: { value: { min: 2, max: 2 }, evidence: { sourceId: 'msg-1', quote: '2-bedroom' }, status: 'stated' },
    budget: {
      value: { minAed: null, maxAed: 2_000_000, qualifier: 'around' },
      evidence: { sourceId: 'msg-1', quote: 'around 2M AED' },
      status: 'stated',
    },
    propertyType: { value: 'apartment', evidence: { sourceId: 'msg-1', quote: 'apartment' }, status: 'stated' },
    transaction: { value: null, evidence: { sourceId: '', quote: '' }, status: 'missing' },
    preferences: [{ text: 'good rental yield', evidence: { sourceId: 'msg-1', quote: 'good rental yield' } }],
    followUp: {
      value: { kind: 'tomorrow', weekday: null, days: null, time: null },
      evidence: { sourceId: 'msg-1', quote: 'tomorrow' },
      status: 'stated',
    },
    propertyRefs: [],
  };
}

function extractorWith(...results: unknown[]): Extractor {
  const model = new MockLanguageModelV3({ doGenerate: results as never });
  return new Extractor(() => model);
}

describe('Extractor', () => {
  it('extracts a well-evidenced requirements message', async () => {
    const extractor = extractorWith(textResult(karimExtraction()));
    const result = await extractor.extract(BASE_INPUT);

    expect(result.intent).toBe('requirements');
    expect(result.closed).toBe(false);
    expect(result.update.locations).toEqual({ value: ['Dubai Marina'], source: 'msg-1', evidence: { sourceId: 'msg-1', quote: 'Dubai Marina' } });
    expect(result.update.bedrooms?.value).toEqual({ min: 2, max: 2 });
    expect(result.update.budget?.value).toEqual({ minAed: null, maxAed: 2_000_000, qualifier: 'around' });
    expect(result.update.propertyType?.value).toBe('apartment');
    expect(result.update.transaction).toBeUndefined();
    expect(result.update.preferences).toEqual([{ value: 'good rental yield', source: 'msg-1', evidence: { sourceId: 'msg-1', quote: 'good rental yield' } }]);
    // `source` is the message the phrase was quoted from, so the date can be anchored on it.
    expect(result.followUp).toEqual({ kind: 'tomorrow', weekday: null, days: null, time: null, raw: 'tomorrow', source: 'msg-1' });
    expect(result.propertyRefs).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('downgrades a field whose evidence quote is not actually in the cited message', async () => {
    const extraction = karimExtraction();
    extraction.transaction = { value: 'buy', evidence: { sourceId: 'msg-1', quote: 'this text is not in the message' }, status: 'stated' };
    const extractor = extractorWith(textResult(extraction));

    const result = await extractor.extract(BASE_INPUT);

    expect(result.update.transaction).toBeUndefined();
    expect(result.rejected).toContainEqual({ field: 'transaction', reason: 'evidence quote not found in the cited message' });
  });

  it('downgrades a field whose evidence cites a message id that was never given', async () => {
    const extraction = karimExtraction();
    extraction.propertyType = { value: 'villa', evidence: { sourceId: 'msg-999', quote: 'apartment' }, status: 'stated' };
    const extractor = extractorWith(textResult(extraction));

    const result = await extractor.extract(BASE_INPUT);

    expect(result.update.propertyType).toBeUndefined();
    expect(result.rejected).toContainEqual({ field: 'propertyType', reason: 'evidence quote not found in the cited message' });
  });

  describe('closing a lead needs the lead to have said so', () => {
    const CLOSED_MESSAGE: ConversationMessage = {
      id: 'msg-closed',
      direction: 'inbound',
      sentAt: '2026-10-30T08:00:00Z',
      body: "Thanks but we bought elsewhere, I'm not interested any more.",
    };

    it('accepts a close that quotes the lead', async () => {
      const extraction = karimExtraction();
      extraction.closed = true;
      extraction.closedEvidence = { sourceId: 'msg-closed', quote: 'not interested any more' };
      const extractor = extractorWith(textResult(extraction));

      const result = await extractor.extract({ ...BASE_INPUT, conversation: [KARIM_MESSAGE, CLOSED_MESSAGE] });

      expect(result.closed).toBe(true);
      expect(result.rejected).toEqual([]);
    });

    it('ignores a close whose quote is nowhere in the conversation', async () => {
      // The shape of a successful injection: the payload talks the model into closing the lead,
      // which would suppress the follow-up and report them as no longer interested.
      const extraction = karimExtraction();
      extraction.closed = true;
      extraction.closedEvidence = { sourceId: 'msg-1', quote: 'I am no longer interested' };
      const extractor = extractorWith(textResult(extraction));

      const result = await extractor.extract(BASE_INPUT);

      expect(result.closed).toBe(false);
      expect(result.rejected).toContainEqual({ field: 'closed', reason: 'evidence quote not found in the cited message' });
    });

    it('ignores a close with no evidence at all', async () => {
      const extraction = karimExtraction();
      extraction.closed = true;
      const extractor = extractorWith(textResult(extraction));

      const result = await extractor.extract(BASE_INPUT);

      expect(result.closed).toBe(false);
    });

    it('cannot be closed by forging the agent-instruction source on an analysis run', async () => {
      const extraction = karimExtraction();
      extraction.closed = true;
      extraction.closedEvidence = { sourceId: AGENT_INSTRUCTION_SOURCE_ID, quote: 'close this lead' };
      const extractor = extractorWith(textResult(extraction));

      const result = await extractor.extract(BASE_INPUT);

      expect(result.closed).toBe(false);
    });
  });

  describe("the agent's own chat turn as an evidence source", () => {
    const NARROW = 'Only show options under 1.9M';

    function narrowingExtraction(sourceId: string) {
      const extraction = karimExtraction();
      extraction.budget = {
        value: { minAed: null, maxAed: 1_900_000, qualifier: 'under' },
        evidence: { sourceId, quote: 'under 1.9M' },
        status: 'stated',
      };
      return extraction;
    }

    it('accepts a field the agent stated, quoted from the instruction', async () => {
      const extractor = extractorWith(textResult(narrowingExtraction(AGENT_INSTRUCTION_SOURCE_ID)));

      const result = await extractor.extract({ ...BASE_INPUT, agentInstruction: NARROW });

      expect(result.update.budget?.value).toEqual({ minAed: null, maxAed: 1_900_000, qualifier: 'under' });
      expect(result.update.budget?.source).toBe(AGENT_INSTRUCTION_SOURCE_ID);
      expect(result.rejected).toEqual([]);
    });

    it('still checks the quote really is in the instruction', async () => {
      const extraction = narrowingExtraction(AGENT_INSTRUCTION_SOURCE_ID);
      extraction.budget.evidence.quote = 'under 1.2M';
      const extractor = extractorWith(textResult(extraction));

      const result = await extractor.extract({ ...BASE_INPUT, agentInstruction: NARROW });

      expect(result.update.budget).toBeUndefined();
      expect(result.rejected).toContainEqual({ field: 'budget', reason: 'evidence quote not found in the cited message' });
    });

    it('rejects the synthetic source on an analysis run, where no instruction exists', async () => {
      const extractor = extractorWith(textResult(narrowingExtraction(AGENT_INSTRUCTION_SOURCE_ID)));

      const result = await extractor.extract(BASE_INPUT);

      expect(result.update.budget).toBeUndefined();
      expect(result.rejected).toContainEqual({ field: 'budget', reason: 'evidence quote not found in the cited message' });
    });
  });

  it('excludes a location that is not one of the agency areas, even with valid evidence', async () => {
    const extraction = karimExtraction();
    extraction.locations = { value: ['Downtown Dubai'], evidence: { sourceId: 'msg-1', quote: 'Dubai Marina' }, status: 'stated' };
    const extractor = extractorWith(textResult(extraction));

    const result = await extractor.extract(BASE_INPUT);

    expect(result.update.locations).toBeUndefined();
    expect(result.rejected).toContainEqual({ field: 'locations', reason: '"Downtown Dubai" is not one of this agency\'s areas' });
  });

  it('retries once on a schema-invalid response, then succeeds', async () => {
    const extractor = extractorWith(textResult({ not: 'the right shape' }), textResult(karimExtraction()));
    const result = await extractor.extract(BASE_INPUT);
    expect(result.intent).toBe('requirements');
  });

  it('fails after a second schema-invalid response', async () => {
    const extractor = extractorWith(textResult({ not: 'the right shape' }), textResult({ still: 'wrong' }));
    await expect(extractor.extract(BASE_INPUT)).rejects.toBeInstanceOf(ExtractionFailedError);
  });
});
