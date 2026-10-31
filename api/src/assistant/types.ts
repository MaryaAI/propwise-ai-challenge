export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface FollowUpTiming {
  kind: 'tomorrow' | 'today' | 'after_weekend' | 'weekday' | 'in_days' | 'unclear';
  weekday: Weekday | null;
  days: number | null;
  time: string | null; // "HH:MM"
  raw: string | null;
  /**
   * The evidence sourceId the phrase was quoted from. This decides what "tomorrow" is relative to:
   * a lead's message anchors on that message's sentAt (TASK.md), while the agent's own chat turn
   * anchors on now. Optional so callers that only care about the classification can omit it.
   */
  source?: string;
}

/** A follow-up date already resolved in the agent's timezone, as persisted on a run. */
export interface ResolvedTiming {
  dueAt: string | null;
  needsClarification: string | null;
}

export type BudgetQualifier = 'around' | 'under' | 'up_to' | 'exact' | 'from' | 'between';

export interface Evidence {
  sourceId: string;
  quote: string;
}

export interface Sourced<T> {
  value: T;
  source: string;
  evidence: Evidence | null;
}

export interface RequirementsState {
  locations: Sourced<string[]> | null;
  bedrooms: Sourced<{ min: number; max: number }> | null;
  budget: Sourced<{ minAed: number | null; maxAed: number | null; qualifier: BudgetQualifier }> | null;
  propertyType: Sourced<'apartment' | 'villa' | 'townhouse' | 'penthouse'> | null;
  transaction: Sourced<'buy' | 'rent'> | null;
  preferences: Sourced<string>[];
}

/** The `requirements` shape from TASK.md's AssistantRun contract. */
export interface ContractRequirements {
  locations: string[];
  bedrooms: number | null;
  budgetAed: { min: number | null; max: number | null };
  propertyType: 'apartment' | 'villa' | 'townhouse' | 'penthouse' | null;
  intent: 'buy' | 'rent' | 'unknown';
  preferences: string[];
}

/**
 * What the agent sees, built from the same merged state as `ContractRequirements` but without the
 * lossy collapses that shape needs for its own contract (bedroom range stays a range; the budget
 * keeps its qualifier and an already-computed `effectiveMaxAed`, so the agent never has to redo
 * that arithmetic itself).
 */
export interface AgentRequirementsBrief {
  locations: string[];
  bedroomsRange: { min: number; max: number } | null;
  budget: { minAed: number | null; maxAed: number | null; qualifier: BudgetQualifier; effectiveMaxAed: number | null } | null;
  propertyType: 'apartment' | 'villa' | 'townhouse' | 'penthouse' | null;
  intent: 'buy' | 'rent' | 'unknown';
  preferences: string[];
}

export interface PropertyFacts {
  id: string;
  agencyId: string;
  reference: string;
  title: string;
  area: string;
  type: string;
  bedrooms: number;
  priceAed: number;
  annualRentAed: number | null;
  status: 'available' | 'reserved' | 'sold';
}

export interface Candidate {
  propertyId: string;
  reason: string;
}

export type Route = 'search' | 'property_question' | 'change_follow_up' | 'rent' | 'clarify' | 'closed';
