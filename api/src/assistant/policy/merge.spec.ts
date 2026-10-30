import { bedroomsRange, mergeRequirements, toContractRequirements } from './merge';
import { RequirementsState, Sourced } from '../types';

function sourced<T>(value: T, source = 'test'): Sourced<T> {
  return { value, source, evidence: null };
}

describe('mergeRequirements', () => {
  it('a fresh analysis (parent null) takes the update, with missing fields null/[]', () => {
    const result = mergeRequirements(null, {
      locations: sourced(['Dubai Marina'], 'msg-1'),
      propertyType: sourced('apartment', 'msg-1'),
    });
    expect(result).toEqual({
      locations: sourced(['Dubai Marina'], 'msg-1'),
      bedrooms: null,
      budget: null,
      propertyType: sourced('apartment', 'msg-1'),
      transaction: null,
      preferences: [],
    });
  });

  it('a chat update changing only the budget preserves the other fields and their sources', () => {
    const parent: RequirementsState = {
      locations: sourced(['Dubai Marina'], 'msg-1'),
      bedrooms: sourced({ min: 2, max: 2 }, 'msg-1'),
      budget: sourced({ minAed: null, maxAed: 2_000_000, qualifier: 'around' }, 'msg-1'),
      propertyType: sourced('apartment', 'msg-1'),
      transaction: sourced('buy', 'msg-1'),
      preferences: [sourced('good rental yield', 'msg-1')],
    };
    const result = mergeRequirements(parent, { budget: sourced({ minAed: null, maxAed: 1_900_000, qualifier: 'under' }, 'run-2') });

    expect(result.locations).toBe(parent.locations);
    expect(result.bedrooms).toBe(parent.bedrooms);
    expect(result.propertyType).toBe(parent.propertyType);
    expect(result.preferences).toBe(parent.preferences);
    expect(result.budget).toEqual(sourced({ minAed: null, maxAed: 1_900_000, qualifier: 'under' }, 'run-2'));
  });

  it('an update with every field null or undefined changes nothing', () => {
    const parent: RequirementsState = {
      locations: sourced(['Dubai Marina'], 'msg-1'),
      bedrooms: sourced({ min: 2, max: 2 }, 'msg-1'),
      budget: null,
      propertyType: null,
      transaction: sourced('buy', 'msg-1'),
      preferences: [],
    };
    const result = mergeRequirements(parent, { locations: null, bedrooms: undefined, preferences: [] });
    expect(result).toEqual(parent);
  });
});

describe('toContractRequirements / bedroomsRange', () => {
  it('studio-or-1-bed collapses to a null contract bedrooms with the range preserved separately', () => {
    const state: RequirementsState = {
      locations: null,
      bedrooms: sourced({ min: 0, max: 1 }),
      budget: null,
      propertyType: null,
      transaction: null,
      preferences: [],
    };
    expect(toContractRequirements(state).bedrooms).toBeNull();
    expect(bedroomsRange(state)).toEqual({ min: 0, max: 1 });
  });

  it('no transaction stated -> intent "unknown"', () => {
    const state: RequirementsState = {
      locations: null,
      bedrooms: null,
      budget: null,
      propertyType: null,
      transaction: null,
      preferences: [],
    };
    expect(toContractRequirements(state).intent).toBe('unknown');
  });

  it('"around 2M" is stored literally as budgetAed.max, with no tolerance applied', () => {
    const state: RequirementsState = {
      locations: null,
      bedrooms: null,
      budget: sourced({ minAed: null, maxAed: 2_000_000, qualifier: 'around' }),
      propertyType: null,
      transaction: null,
      preferences: [],
    };
    expect(toContractRequirements(state).budgetAed).toEqual({ min: null, max: 2_000_000 });
  });
});
