import { route } from './router';
import { RequirementsState, Sourced } from '../types';

function sourced<T>(value: T): Sourced<T> {
  return { value, source: 'test', evidence: null };
}

function emptyState(partial: Partial<RequirementsState> = {}): RequirementsState {
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

const karimState = emptyState({
  locations: sourced(['Dubai Marina']),
  bedrooms: sourced({ min: 2, max: 2 }),
  budget: sourced({ minAed: null, maxAed: 2_000_000, qualifier: 'around' }),
  propertyType: sourced('apartment'),
});

describe('route', () => {
  it('closed takes precedence over everything else', () => {
    expect(route({ trigger: 'chat', intent: 'change_follow_up', closed: true, state: karimState })).toBe('closed');
  });

  it('chat + change_follow_up -> change_follow_up', () => {
    expect(route({ trigger: 'chat', intent: 'change_follow_up', closed: false, state: emptyState() })).toBe('change_follow_up');
  });

  it('chat + property_question -> property_question', () => {
    expect(route({ trigger: 'chat', intent: 'property_question', closed: false, state: emptyState() })).toBe('property_question');
  });

  it('chat + other -> property_question', () => {
    expect(route({ trigger: 'chat', intent: 'other', closed: false, state: emptyState() })).toBe('property_question');
  });

  it('transaction rent -> rent', () => {
    const state = emptyState({ transaction: sourced('rent'), locations: sourced(['Business Bay']) });
    expect(route({ trigger: 'analysis', intent: 'requirements', closed: false, state })).toBe('rent');
  });

  it('no search field present -> clarify', () => {
    expect(route({ trigger: 'analysis', intent: 'requirements', closed: false, state: emptyState() })).toBe('clarify');
  });

  it('a search field present, not rent, not closed -> search', () => {
    expect(route({ trigger: 'analysis', intent: 'requirements', closed: false, state: karimState })).toBe('search');
  });

  it('Hassan: analysis + other + no fields ("Hi") -> clarify', () => {
    expect(route({ trigger: 'analysis', intent: 'other', closed: false, state: emptyState() })).toBe('clarify');
  });

  it('Tom: analysis + property_question with area and bedrooms -> search', () => {
    const state = emptyState({ locations: sourced(['Downtown Dubai']), bedrooms: sourced({ min: 1, max: 1 }) });
    expect(route({ trigger: 'analysis', intent: 'property_question', closed: false, state })).toBe('search');
  });

  it('chat + requirements, merged state still has Karim\'s fields -> search', () => {
    expect(route({ trigger: 'chat', intent: 'requirements', closed: false, state: karimState })).toBe('search');
  });
});
