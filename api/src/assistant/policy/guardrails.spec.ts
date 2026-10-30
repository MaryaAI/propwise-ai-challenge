import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stableId } from '../../db/stable-id';
import { Candidate, PropertyFacts, RequirementsState, Sourced } from '../types';
import { effectiveMaxAed, filterRecommendations, hasYieldPreference, selectRecommendations } from './guardrails';

interface PropertySeed {
  agency: string;
  reference: string;
  area: string;
  type: string;
  bedrooms: number;
  priceAed: number;
  annualRentAed: number | null;
  status: 'available' | 'reserved' | 'sold';
}

const SEED_DIR = join(__dirname, '..', '..', '..', '..', 'seed');
const properties = JSON.parse(readFileSync(join(SEED_DIR, 'properties.json'), 'utf8')) as PropertySeed[];

const facts = new Map<string, PropertyFacts>(
  properties.map((p) => [
    stableId('property', p.reference),
    {
      id: stableId('property', p.reference),
      agencyId: stableId('agency', p.agency),
      reference: p.reference,
      area: p.area,
      type: p.type,
      bedrooms: p.bedrooms,
      priceAed: p.priceAed,
      annualRentAed: p.annualRentAed,
      status: p.status,
    },
  ]),
);

const MARINA_BAY = stableId('agency', 'marina-bay');
const marinaBayIds = new Set(properties.filter((p) => p.agency === 'marina-bay').map((p) => stableId('property', p.reference)));

function ref(reference: string): string {
  return stableId('property', reference);
}

function sourced<T>(value: T): Sourced<T> {
  return { value, source: 'test', evidence: null };
}

function candidate(reference: string, reason = ''): Candidate {
  return { propertyId: ref(reference), reason };
}

function requirements(partial: Partial<RequirementsState>): RequirementsState {
  return {
    locations: null,
    bedrooms: null,
    budget: null,
    propertyType: null,
    transaction: null,
    preferences: [],
    ...partial,
  };
}

const karimRequirements = requirements({
  locations: sourced(['Dubai Marina']),
  bedrooms: sourced({ min: 2, max: 2 }),
  budget: sourced({ minAed: null, maxAed: 2_000_000, qualifier: 'around' }),
  propertyType: sourced('apartment'),
  preferences: [sourced('good rental yield')],
});

describe('filterRecommendations + selectRecommendations: Karim (2-bed Dubai Marina, ~2M)', () => {
  const candidates = [
    'MBR-1003',
    'MBR-1005',
    'MBR-1006',
    'MBR-1007',
    'MBR-1008',
    'MBR-1001',
    'MBR-1022',
    'MBR-1013',
    'MBR-1002',
  ].map((r) => candidate(r));
  candidates.push({ propertyId: ref('DKP-2001'), reason: '' });
  const randomId = randomUUID();
  candidates.push({ propertyId: randomId, reason: '' });
  candidates.push(candidate('MBR-1001')); // duplicate

  const { accepted, rejected } = filterRecommendations({
    candidates,
    facts,
    agencyId: MARINA_BAY,
    requirements: karimRequirements,
    seenIds: marinaBayIds,
  });

  it('accepts, in input order, exactly the listings that pass every hard filter', () => {
    expect(accepted.map((c) => c.propertyId)).toEqual(['MBR-1007', 'MBR-1001', 'MBR-1022', 'MBR-1002'].map(ref));
  });

  it('rejects every other candidate with the expected reason, in candidate order', () => {
    expect(rejected).toEqual([
      { propertyId: ref('MBR-1003'), why: 'price_high' },
      { propertyId: ref('MBR-1005'), why: 'not_available' },
      { propertyId: ref('MBR-1006'), why: 'not_available' },
      { propertyId: ref('MBR-1008'), why: 'price_high' },
      { propertyId: ref('MBR-1013'), why: 'area' },
      { propertyId: ref('DKP-2001'), why: 'other_agency' },
      { propertyId: randomId, why: 'not_found' },
      { propertyId: ref('MBR-1001'), why: 'duplicate' },
    ]);
  });

  it('selectRecommendations sorts the accepted set by yield, since Karim has a yield preference', () => {
    const selected = selectRecommendations({ accepted, facts, preferences: karimRequirements.preferences.map((p) => p.value) });
    expect(selected.map((c) => c.propertyId)).toEqual(['MBR-1001', 'MBR-1007', 'MBR-1002', 'MBR-1022'].map(ref));
  });
});

describe('guardrails extra cases', () => {
  it('effectiveMaxAed applies a 5% tolerance for "around", exactly', () => {
    expect(effectiveMaxAed({ maxAed: 2_000_000, qualifier: 'around' })).toBe(2_100_000);
  });

  it('a candidate missing from seenIds is rejected as not_seen', () => {
    const seenIds = new Set(marinaBayIds);
    seenIds.delete(ref('MBR-1007'));
    const { rejected } = filterRecommendations({
      candidates: [candidate('MBR-1007')],
      facts,
      agencyId: MARINA_BAY,
      requirements: karimRequirements,
      seenIds,
    });
    expect(rejected).toEqual([{ propertyId: ref('MBR-1007'), why: 'not_seen' }]);
  });

  it('"under" gives no tolerance, so MBR-1001 (2.05M) fails a 2.0M cap', () => {
    const underRequirements = requirements({
      ...karimRequirements,
      budget: sourced({ minAed: null, maxAed: 2_000_000, qualifier: 'under' }),
    });
    const { rejected } = filterRecommendations({
      candidates: [candidate('MBR-1001')],
      facts,
      agencyId: MARINA_BAY,
      requirements: underRequirements,
      seenIds: marinaBayIds,
    });
    expect(rejected).toEqual([{ propertyId: ref('MBR-1001'), why: 'price_high' }]);
  });

  it("Alex (JVC studio-or-1-bed, under 900k): MBR-1017 fails on bedrooms (2BR)", () => {
    const alexRequirements = requirements({
      locations: sourced(['Jumeirah Village Circle']),
      bedrooms: sourced({ min: 0, max: 1 }),
      budget: sourced({ minAed: null, maxAed: 900_000, qualifier: 'under' }),
    });
    const { rejected } = filterRecommendations({
      candidates: [candidate('MBR-1017')],
      facts,
      agencyId: MARINA_BAY,
      requirements: alexRequirements,
      seenIds: marinaBayIds,
    });
    expect(rejected).toEqual([{ propertyId: ref('MBR-1017'), why: 'bedrooms' }]);
  });

  it('Lina (Dubai Marina, 5-bed villa, under 900k): nothing in Marina Bay qualifies', () => {
    const linaRequirements = requirements({
      locations: sourced(['Dubai Marina']),
      bedrooms: sourced({ min: 5, max: 5 }),
      budget: sourced({ minAed: null, maxAed: 900_000, qualifier: 'under' }),
      propertyType: sourced('villa'),
    });
    const allMarinaBayCandidates = properties.filter((p) => p.agency === 'marina-bay').map((p) => candidate(p.reference));
    const { accepted } = filterRecommendations({
      candidates: allMarinaBayCandidates,
      facts,
      agencyId: MARINA_BAY,
      requirements: linaRequirements,
      seenIds: marinaBayIds,
    });
    expect(accepted).toEqual([]);
  });

  it('selectRecommendations with a yield preference returns the 5 highest-yield of 7, not the first 5 given', () => {
    const scrambled = ['MBR-1008', 'MBR-1003', 'MBR-1022', 'MBR-1004', 'MBR-1001', 'MBR-1002', 'MBR-1007'].map((r) => candidate(r));
    const selected = selectRecommendations({ accepted: scrambled, facts, preferences: ['good rental yield'] });
    expect(selected.map((c) => c.propertyId)).toEqual(['MBR-1001', 'MBR-1007', 'MBR-1002', 'MBR-1004', 'MBR-1003'].map(ref));
  });

  it('selectRecommendations with no yield preference keeps the given order', () => {
    const given = ['MBR-1008', 'MBR-1003', 'MBR-1022', 'MBR-1004', 'MBR-1001', 'MBR-1002'].map((r) => candidate(r));
    const selected = selectRecommendations({ accepted: given, facts, preferences: [] });
    expect(selected.map((c) => c.propertyId)).toEqual(given.slice(0, 5).map((c) => c.propertyId));
  });

  it.each([
    [['good rental yield'], true],
    [['near Detroit'], false],
  ])('hasYieldPreference(%j) -> %s', (preferences, expected) => {
    expect(hasYieldPreference(preferences)).toBe(expected);
  });
});
