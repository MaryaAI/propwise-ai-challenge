import { render, screen } from '@testing-library/react-native';
import type { AssistantRun, Recommendation } from '../lib/api';
import { RunCard } from './RunCard';

function run(overrides: Partial<AssistantRun> = {}): AssistantRun {
  return {
    id: 'run-1',
    leadId: 'lead-1',
    messageId: 'msg-1',
    status: 'completed',
    requirements: {
      locations: ['Dubai Marina'],
      bedrooms: 2,
      budgetAed: { min: null, max: 2_000_000 },
      propertyType: 'apartment',
      intent: 'buy',
      preferences: ['good rental yield'],
    },
    recommendations: [],
    summary: '',
    proposedActions: [],
    trace: [],
    createdAt: '2026-10-30T06:00:00.000Z',
    parentRunId: null,
    trigger: 'analysis',
    agentMessage: null,
    reply: '',
    ...overrides,
  };
}

function recommendation(overrides: Partial<Recommendation['property']> = {}): Recommendation {
  return {
    propertyId: 'prop-1',
    reason: 'Priced under budget with a strong yield.',
    property: {
      reference: 'MBR-1001',
      title: 'Marina Gate 2BR',
      area: 'Dubai Marina',
      bedrooms: 2,
      priceAed: 2_050_000,
      annualRentAed: 150_000,
      grossYield: 0.07317073170731707,
      status: 'available',
      ...overrides,
    },
  };
}

describe('RunCard', () => {
  it('renders the yield as a percentage, not the raw ratio the API sends', async () => {
    await render(<RunCard run={run({ recommendations: [recommendation()] })} />);
    expect(screen.getByText(/7\.3% gross yield/)).toBeTruthy();
  });

  it('says so when a listing has no known yield', async () => {
    await render(<RunCard run={run({ recommendations: [recommendation({ annualRentAed: null, grossYield: null })] })} />);
    expect(screen.getByText(/Yield unavailable/)).toBeTruthy();
  });

  it('calls a zero-bedroom listing a studio rather than dropping it', async () => {
    await render(<RunCard run={run({ recommendations: [recommendation({ bedrooms: 0 })] })} />);
    expect(screen.getByText(/Studio/)).toBeTruthy();
  });

  // Split across two tests rather than unmounting and re-rendering in one: RNTL's async render
  // reports overlapping act() calls for that, and it corrupts `screen` for the next test.
  it('shows a failed run as a failure, not as "nothing found"', async () => {
    await render(<RunCard run={run({ status: 'failed', error: 'invalid x-api-key' })} />);
    expect(screen.getByText(/The run failed/)).toBeTruthy();
    expect(screen.getByText(/invalid x-api-key/)).toBeTruthy();
    expect(screen.queryByText(/No listings recommended/)).toBeNull();
  });

  it('shows a completed run that found nothing as exactly that', async () => {
    await render(<RunCard run={run({ summary: 'Nothing in the Marina fits that budget.' })} />);
    expect(screen.getByText(/No listings recommended/)).toBeTruthy();
    expect(screen.getByText('Nothing in the Marina fits that budget.')).toBeTruthy();
    expect(screen.queryByText(/The run failed/)).toBeNull();
  });

  it('shows what it understood', async () => {
    await render(<RunCard run={run()} />);
    expect(screen.getByText(/Dubai Marina · 2 bed · apartment · up to AED 2,000,000 · to buy/)).toBeTruthy();
  });
});
