import { z } from 'zod';
import { AgentRequirementsBrief, ContractRequirements, RequirementsState } from '../types';
import { effectiveMaxAed } from './guardrails';

const EMPTY_STATE: RequirementsState = {
  locations: null,
  bedrooms: null,
  budget: null,
  propertyType: null,
  transaction: null,
  preferences: [],
};

export function emptyRequirementsState(): RequirementsState {
  return { ...EMPTY_STATE, preferences: [] };
}

const EvidenceCodec = z.object({ sourceId: z.string(), quote: z.string() }).nullable();

function sourcedCodec<T extends z.ZodTypeAny>(value: T) {
  return z.object({ value, source: z.string(), evidence: EvidenceCodec });
}

/**
 * The shape of `extraction.state` as persisted. It is our own JSON, but it comes back out of a
 * jsonb column and rows written before this field existed simply will not have it -- so it is
 * parsed defensively rather than cast.
 */
const RequirementsStateCodec = z.object({
  locations: sourcedCodec(z.array(z.string())).nullable(),
  bedrooms: sourcedCodec(z.object({ min: z.number().int(), max: z.number().int() })).nullable(),
  budget: sourcedCodec(
    z.object({
      minAed: z.number().int().nullable(),
      maxAed: z.number().int().nullable(),
      qualifier: z.enum(['around', 'under', 'up_to', 'exact', 'from', 'between']),
    }),
  ).nullable(),
  propertyType: sourcedCodec(z.enum(['apartment', 'villa', 'townhouse', 'penthouse'])).nullable(),
  transaction: sourcedCodec(z.enum(['buy', 'rent'])).nullable(),
  preferences: z.array(sourcedCodec(z.string())),
});

/**
 * Reads a parent run's `extraction.state` back into a `RequirementsState`. Returns null when the
 * field is absent or malformed, so a chat turn on an older run starts from scratch rather than
 * failing -- the lossy `requirements` column cannot stand in for it, since it drops
 * `budget.qualifier` and collapses the bedroom range.
 */
export function parseRequirementsState(value: unknown): RequirementsState | null {
  const parsed = RequirementsStateCodec.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function mergeRequirements(parent: RequirementsState | null, update: Partial<RequirementsState>): RequirementsState {
  const merged: RequirementsState = { ...(parent ?? EMPTY_STATE) };

  if (update.locations !== undefined && update.locations !== null) merged.locations = update.locations;
  if (update.bedrooms !== undefined && update.bedrooms !== null) merged.bedrooms = update.bedrooms;
  if (update.budget !== undefined && update.budget !== null) merged.budget = update.budget;
  if (update.propertyType !== undefined && update.propertyType !== null) merged.propertyType = update.propertyType;
  if (update.transaction !== undefined && update.transaction !== null) merged.transaction = update.transaction;
  if (update.preferences !== undefined && update.preferences.length > 0) merged.preferences = update.preferences;

  return merged;
}

export function bedroomsRange(state: RequirementsState): { min: number; max: number } | null {
  return state.bedrooms?.value ?? null;
}

export function toContractRequirements(state: RequirementsState): ContractRequirements {
  const bedrooms = state.bedrooms;
  return {
    locations: state.locations?.value ?? [],
    bedrooms: bedrooms !== null && bedrooms.value.min === bedrooms.value.max ? bedrooms.value.min : null,
    budgetAed: { min: state.budget?.value.minAed ?? null, max: state.budget?.value.maxAed ?? null },
    propertyType: state.propertyType?.value ?? null,
    intent: state.transaction === null ? 'unknown' : state.transaction.value,
    preferences: state.preferences.map((p) => p.value),
  };
}

/** What the agent sees: unlike `toContractRequirements`, the bedroom range and budget qualifier survive. */
export function toAgentBrief(state: RequirementsState): AgentRequirementsBrief {
  const budget = state.budget?.value ?? null;
  return {
    locations: state.locations?.value ?? [],
    bedroomsRange: state.bedrooms?.value ?? null,
    budget: budget && { ...budget, effectiveMaxAed: effectiveMaxAed(budget) },
    propertyType: state.propertyType?.value ?? null,
    intent: state.transaction === null ? 'unknown' : state.transaction.value,
    preferences: state.preferences.map((p) => p.value),
  };
}
