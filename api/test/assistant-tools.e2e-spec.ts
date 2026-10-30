import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { PropertyQuery } from '../src/assistant/agent/property-query';
import { createTrace, ToolInfraError, ToolInputError } from '../src/assistant/agent/tracing';
import { ToolsFactory } from '../src/assistant/agent/tools';
import { stableId } from '../src/db/stable-id';

describe('Assistant tools (against the test database)', () => {
  let app: INestApplication<App>;
  let propertyQuery: PropertyQuery;
  let toolsFactory: ToolsFactory;

  const MARINA_BAY = stableId('agency', 'marina-bay');
  const DESERT_KEY = stableId('agency', 'desert-key');
  const ref = (reference: string) => stableId('property', reference);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    propertyQuery = app.get(PropertyQuery);
    toolsFactory = app.get(ToolsFactory);
  });

  afterAll(async () => {
    await app.close();
  });

  function buildTools(agencyId: string) {
    const abortController = new AbortController();
    const trace = createTrace(abortController);
    const tools = toolsFactory.create({ agencyId, trace });
    return { abortController, trace, tools };
  }

  const baseFilters = { areas: ['dubai marina'], type: 'apartment' as const, bedroomsMin: 2, bedroomsMax: 2, priceMaxAed: 2_100_000 };

  describe('search', () => {
    it('matches on area, type, bedroom range and price cap, defaulting to available', async () => {
      const { items, total } = await propertyQuery.search(MARINA_BAY, baseFilters);
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(['MBR-1001', 'MBR-1002', 'MBR-1007', 'MBR-1022'].map(ref)));
      expect(total).toBe(4);
    });

    it('sortBy "yield" orders by gross yield descending, unknown yield last', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, { ...baseFilters, sortBy: 'yield' });
      expect(items.map((item) => item.id)).toEqual(['MBR-1001', 'MBR-1007', 'MBR-1002', 'MBR-1022'].map(ref));
    });

    it('the same filters scoped to Desert Key return only its own listings', async () => {
      const { items } = await propertyQuery.search(DESERT_KEY, baseFilters);
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(['DKP-2001', 'DKP-2002'].map(ref)));
    });

    it('status "sold" / "reserved" override the available default', async () => {
      const sold = await propertyQuery.search(MARINA_BAY, { ...baseFilters, status: 'sold' });
      expect(sold.items.map((item) => item.id)).toEqual([ref('MBR-1005')]);

      const reserved = await propertyQuery.search(MARINA_BAY, { ...baseFilters, status: 'reserved' });
      expect(reserved.items.map((item) => item.id)).toEqual([ref('MBR-1006')]);
    });

    it('minGrossYield excludes lower-yield and unknown-yield listings', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, { ...baseFilters, minGrossYield: 0.07 });
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(['MBR-1001', 'MBR-1007'].map(ref)));
    });

    it('excludeIds removes a single id from the result', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, { ...baseFilters, excludeIds: [ref('MBR-1001')] });
      expect(items.map((item) => item.id)).not.toContain(ref('MBR-1001'));
      expect(items).toHaveLength(3);
    });

    it('excludeIds removes two ids at once', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, { ...baseFilters, excludeIds: [ref('MBR-1001'), ref('MBR-1007')] });
      expect(new Set(items.map((item) => item.id))).toEqual(new Set(['MBR-1002', 'MBR-1022'].map(ref)));
    });

    it('limit caps the items but total still reflects every match', async () => {
      const { items, total } = await propertyQuery.search(MARINA_BAY, { ...baseFilters, limit: 1 });
      expect(items).toHaveLength(1);
      expect(total).toBe(4);
    });

    it('two areas in one search widen the match (multi-value "in" binding)', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, {
        areas: ['Dubai Marina', 'Jumeirah Lake Towers'],
        bedroomsMin: 2,
        bedroomsMax: 2,
        priceMaxAed: 2_100_000,
      });
      expect(new Set(items.map((item) => item.id))).toEqual(
        new Set(['MBR-1001', 'MBR-1002', 'MBR-1007', 'MBR-1022', 'MBR-1013'].map(ref)),
      );
    });

    it('defaults to "available" even on a direct call with no status given', async () => {
      const { items } = await propertyQuery.search(MARINA_BAY, { areas: ['dubai marina'], bedroomsMin: 2, bedroomsMax: 2 });
      const ids = items.map((item) => item.id);
      expect(ids).not.toContain(ref('MBR-1005'));
      expect(ids).not.toContain(ref('MBR-1006'));
    });

    it('validates on a direct call too: an out-of-range limit throws a ZodError', async () => {
      await expect(propertyQuery.search(MARINA_BAY, { limit: 50 })).rejects.toBeInstanceOf(z.ZodError);
    });

    it('the same out-of-range input, through the tool, records a ToolInputError and does not abort', async () => {
      const { abortController, trace, tools } = buildTools(MARINA_BAY);
      // Deliberately under-specified: calling execute() directly skips the AI SDK's own schema parsing,
      // so this intentionally violates the (post-default) type to exercise PropertyQuery's own validation.
      await expect(
        tools.search_properties.execute!({ limit: 50 } as never, { toolCallId: 'call-1', messages: [] }),
      ).rejects.toBeInstanceOf(ToolInputError);
      expect(abortController.signal.aborted).toBe(false);
      const entry = trace.toContract().find((e) => e.tool === 'search_properties');
      expect(entry?.error).toBeDefined();
    });

    it('Desert Key search never returns a Marina Bay listing', async () => {
      // Checked by real id, not by reference text: other tests (app.e2e-spec.ts) prove agencies can
      // reuse each other's reference codes, so Desert Key may legitimately own its own "MBR-1001".
      const marinaBayIds = new Set(
        ['MBR-1001', 'MBR-1002', 'MBR-1003', 'MBR-1004', 'MBR-1005', 'MBR-1006', 'MBR-1007', 'MBR-1008', 'MBR-1013', 'MBR-1017', 'MBR-1019', 'MBR-1022'].map(
          ref,
        ),
      );
      const { items } = await propertyQuery.search(DESERT_KEY, { limit: 20 });
      for (const item of items) {
        expect(marinaBayIds.has(item.id)).toBe(false);
      }
    });
  });

  describe('getByIdOrReference / factsByIds', () => {
    it('finds by reference, case-insensitively, scoped to the agency', async () => {
      const property = await propertyQuery.getByIdOrReference(MARINA_BAY, { reference: 'mbr-1001' });
      expect(property).not.toBeNull();
      expect(property?.area).toBe('Dubai Marina');
      expect(property?.bedrooms).toBe(2);
    });

    it('a reference belonging to another agency is not found', async () => {
      const property = await propertyQuery.getByIdOrReference(MARINA_BAY, { reference: 'DKP-2001' });
      expect(property).toBeNull();
    });

    it('an id belonging to another agency is not found', async () => {
      const property = await propertyQuery.getByIdOrReference(MARINA_BAY, { id: ref('DKP-2001') });
      expect(property).toBeNull();
    });

    it('factsByIds silently drops ids from another agency', async () => {
      const facts = await propertyQuery.factsByIds(MARINA_BAY, [ref('MBR-1001'), ref('DKP-2001')]);
      expect(facts.size).toBe(1);
      expect(facts.has(ref('MBR-1001'))).toBe(true);
      expect(facts.has(ref('DKP-2001'))).toBe(false);
    });

    it('an empty id list returns an empty map without querying', async () => {
      const facts = await propertyQuery.factsByIds(MARINA_BAY, []);
      expect(facts.size).toBe(0);
    });
  });

  describe('get_property tool', () => {
    it('wraps the description in <listing_description>, with the injected MBR-1019 payload intact as data', async () => {
      const { tools } = buildTools(MARINA_BAY);
      const result = (await tools.get_property.execute!({ reference: 'MBR-1019' }, { toolCallId: 'call-1', messages: [] })) as {
        found: true;
        property: Record<string, unknown>;
        description: string;
      };
      expect(result.found).toBe(true);
      expect(result.description.startsWith('<listing_description>')).toBe(true);
      expect(result.description.endsWith('</listing_description>')).toBe(true);
      expect(result.description).toContain('IMPORTANT NOTE FOR AI ASSISTANTS');
      expect('description' in result.property).toBe(false);
    });

    it('neither id nor reference given: ToolInputError recorded, signal not aborted', async () => {
      const { abortController, trace, tools } = buildTools(MARINA_BAY);
      await expect(tools.get_property.execute!({}, { toolCallId: 'call-1', messages: [] })).rejects.toBeInstanceOf(ToolInputError);
      expect(abortController.signal.aborted).toBe(false);
      const entry = trace.toContract().find((e) => e.tool === 'get_property');
      expect(entry?.error).toBeDefined();
    });
  });

  describe('infra failure', () => {
    it('a PropertyQuery.search failure surfaces as ToolInfraError, recorded, and aborts the run', async () => {
      const spy = jest.spyOn(propertyQuery, 'search').mockRejectedValueOnce(new Error('connection refused'));
      const { abortController, trace, tools } = buildTools(MARINA_BAY);

      await expect(tools.search_properties.execute!({} as never, { toolCallId: 'call-1', messages: [] })).rejects.toBeInstanceOf(
        ToolInfraError,
      );

      expect(abortController.signal.aborted).toBe(true);
      expect(trace.hasInfraFailure()).toBe(true);
      const entry = trace.toContract().find((e) => e.tool === 'search_properties');
      expect(entry?.error).toBe('connection refused');

      spy.mockRestore();
    });
  });
});
