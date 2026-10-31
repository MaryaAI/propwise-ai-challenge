import { render, screen } from '@testing-library/react';
import type { AssistantRun, Recommendation } from '@/lib/api';
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
  it('renders the yield as a percentage, not the raw ratio the API sends', () => {
    render(<RunCard run={run({ recommendations: [recommendation()] })} />);
    expect(screen.getByText(/7\.3% gross yield/)).toBeInTheDocument();
    expect(screen.queryByText(/0\.073/)).not.toBeInTheDocument();
  });

  it('says so when a listing has no known yield', () => {
    render(<RunCard run={run({ recommendations: [recommendation({ annualRentAed: null, grossYield: null })] })} />);
    expect(screen.getByText(/Yield unavailable/)).toBeInTheDocument();
  });

  it('calls a zero-bedroom listing a studio rather than dropping it', () => {
    render(<RunCard run={run({ recommendations: [recommendation({ bedrooms: 0 })] })} />);
    expect(screen.getByText(/Studio/)).toBeInTheDocument();
  });

  it('calls a zero-bedroom requirement a studio too', () => {
    const requirements = { ...run().requirements, bedrooms: 0 };
    render(<RunCard run={run({ requirements })} />);
    expect(screen.getByText(/Studio/)).toBeInTheDocument();
  });

  it('distinguishes a failed run from one that found nothing', () => {
    const { unmount } = render(<RunCard run={run({ status: 'failed', error: 'invalid x-api-key' })} />);
    expect(screen.getByText(/The run failed/)).toBeInTheDocument();
    expect(screen.getByText(/invalid x-api-key/)).toBeInTheDocument();
    // A failure must not read as "nothing found" (TASK.md).
    expect(screen.queryByText(/No listings recommended/)).not.toBeInTheDocument();
    unmount();

    render(<RunCard run={run({ summary: 'Nothing in the Marina fits that budget.' })} />);
    expect(screen.getByText(/No listings recommended/)).toBeInTheDocument();
    expect(screen.getByText('Nothing in the Marina fits that budget.')).toBeInTheDocument();
    expect(screen.queryByText(/The run failed/)).not.toBeInTheDocument();
  });

  it('shows what it understood', () => {
    render(<RunCard run={run()} />);
    expect(screen.getByText(/Dubai Marina · 2 bed · apartment · up to AED 2,000,000 · to buy/)).toBeInTheDocument();
    expect(screen.getByText(/Prefers good rental yield/)).toBeInTheDocument();
  });

  it('lists the tool calls it made', () => {
    render(<RunCard run={run({ trace: [{ tool: 'search_properties', input: {}, output: null, durationMs: 42 }] })} />);
    expect(screen.getByText('1 tool calls')).toBeInTheDocument();
    expect(screen.getByText(/search_properties · 42ms/)).toBeInTheDocument();
  });
});
