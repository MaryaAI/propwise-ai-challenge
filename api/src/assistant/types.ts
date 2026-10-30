export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface FollowUpTiming {
  kind: 'tomorrow' | 'today' | 'after_weekend' | 'weekday' | 'in_days' | 'unclear';
  weekday: Weekday | null;
  days: number | null;
  time: string | null; // "HH:MM"
  raw: string | null;
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

export interface PropertyFacts {
  id: string;
  agencyId: string;
  reference: string;
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
