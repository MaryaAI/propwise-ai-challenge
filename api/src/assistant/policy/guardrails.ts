import { BudgetQualifier, Candidate, PropertyFacts, RequirementsState } from '../types';

export function grossYield(p: PropertyFacts): number | null {
  return p.annualRentAed === null ? null : p.annualRentAed / p.priceAed;
}

export function effectiveMaxAed(budget: { maxAed: number | null; qualifier: BudgetQualifier } | null): number | null {
  if (budget === null || budget.maxAed === null) return null;
  return budget.qualifier === 'around' ? Math.floor((budget.maxAed * 105) / 100) : budget.maxAed;
}

export function hasYieldPreference(preferences: string[]): boolean {
  return preferences.some((p) => /yield|\broi\b|rental return|عائد|مردود/i.test(p));
}

type RejectionReason =
  | 'duplicate'
  | 'not_found'
  | 'other_agency'
  | 'not_available'
  | 'not_seen'
  | 'area'
  | 'bedrooms'
  | 'type'
  | 'price_low'
  | 'price_high';

function checkCandidate(
  propertyId: string,
  ctx: {
    facts: Map<string, PropertyFacts>;
    agencyId: string;
    locations: string[] | null;
    bedroomsRange: { min: number; max: number } | null;
    propertyType: string | null;
    minAed: number | null;
    effectiveMax: number | null;
    seenIds: Set<string>;
  },
): RejectionReason | null {
  const p = ctx.facts.get(propertyId);
  if (!p) return 'not_found';
  if (p.agencyId !== ctx.agencyId) return 'other_agency';
  if (p.status !== 'available') return 'not_available';
  if (!ctx.seenIds.has(propertyId)) return 'not_seen';
  if (ctx.locations && ctx.locations.length > 0 && !ctx.locations.includes(p.area)) return 'area';
  if (ctx.bedroomsRange && (p.bedrooms < ctx.bedroomsRange.min || p.bedrooms > ctx.bedroomsRange.max)) return 'bedrooms';
  if (ctx.propertyType && p.type !== ctx.propertyType) return 'type';
  if (ctx.minAed !== null && p.priceAed < ctx.minAed) return 'price_low';
  if (ctx.effectiveMax !== null && p.priceAed > ctx.effectiveMax) return 'price_high';
  return null;
}

export function filterRecommendations(args: {
  candidates: Candidate[];
  facts: Map<string, PropertyFacts>;
  agencyId: string;
  requirements: RequirementsState;
  seenIds: Set<string>;
}): { accepted: Candidate[]; rejected: { propertyId: string; why: string }[] } {
  const { candidates, facts, agencyId, requirements, seenIds } = args;

  const locations = requirements.locations?.value ?? null;
  const bedroomsRange = requirements.bedrooms?.value ?? null;
  const propertyType = requirements.propertyType?.value ?? null;
  const budget = requirements.budget?.value ?? null;
  const minAed = budget?.minAed ?? null;
  const effectiveMax = effectiveMaxAed(budget);

  const accepted: Candidate[] = [];
  const rejected: { propertyId: string; why: string }[] = [];
  const seenInList = new Set<string>();

  for (const candidate of candidates) {
    const why: RejectionReason | null = seenInList.has(candidate.propertyId)
      ? 'duplicate'
      : checkCandidate(candidate.propertyId, { facts, agencyId, locations, bedroomsRange, propertyType, minAed, effectiveMax, seenIds });
    seenInList.add(candidate.propertyId);

    if (why === null) {
      accepted.push(candidate);
    } else {
      rejected.push({ propertyId: candidate.propertyId, why });
    }
  }

  return { accepted, rejected };
}

export function sortByYield(accepted: Candidate[], facts: Map<string, PropertyFacts>): Candidate[] {
  return [...accepted].sort((a, b) => {
    const pa = facts.get(a.propertyId)!;
    const pb = facts.get(b.propertyId)!;
    const ya = grossYield(pa);
    const yb = grossYield(pb);

    if (ya === null && yb !== null) return 1;
    if (ya !== null && yb === null) return -1;
    if (ya !== null && yb !== null && ya !== yb) return yb - ya;

    if (pa.priceAed !== pb.priceAed) return pa.priceAed - pb.priceAed;
    return pa.reference.localeCompare(pb.reference);
  });
}

export function selectRecommendations(args: {
  accepted: Candidate[];
  facts: Map<string, PropertyFacts>;
  preferences: string[];
  max?: number;
}): Candidate[] {
  const { accepted, facts, preferences, max = 5 } = args;
  const ordered = hasYieldPreference(preferences) ? sortByYield(accepted, facts) : accepted;
  return ordered.slice(0, max);
}
