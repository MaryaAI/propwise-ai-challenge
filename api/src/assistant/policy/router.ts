import { RequirementsState, Route } from '../types';

export interface RouteInput {
  trigger: 'analysis' | 'chat';
  intent: 'requirements' | 'property_question' | 'change_follow_up' | 'other';
  closed: boolean;
  state: RequirementsState;
}

function hasSearchField(state: RequirementsState): boolean {
  const hasLocations = state.locations !== null && state.locations.value.length > 0;
  const hasBedrooms = state.bedrooms !== null;
  const hasBudget = state.budget !== null;
  const hasPropertyType = state.propertyType !== null;
  return hasLocations || hasBedrooms || hasBudget || hasPropertyType;
}

export function route({ trigger, intent, closed, state }: RouteInput): Route {
  if (closed) return 'closed';
  if (trigger === 'chat' && intent === 'change_follow_up') return 'change_follow_up';
  if (trigger === 'chat' && (intent === 'property_question' || intent === 'other')) return 'property_question';
  if (state.transaction !== null && state.transaction.value === 'rent') return 'rent';
  if (!hasSearchField(state)) return 'clarify';
  return 'search';
}
