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
