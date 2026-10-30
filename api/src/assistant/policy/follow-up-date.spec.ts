import { computeDueAt } from './follow-up-date';
import { FollowUpTiming } from '../types';

const TZ = 'Asia/Dubai';

function timing(partial: Partial<FollowUpTiming> & { kind: FollowUpTiming['kind'] }): FollowUpTiming {
  return { weekday: null, days: null, time: null, raw: null, ...partial };
}

describe('computeDueAt', () => {
  it('tomorrow: Friday sentAt -> Saturday 10:00', () => {
    const result = computeDueAt(timing({ kind: 'tomorrow' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-10-31T10:00:00+04:00', needsClarification: null });
  });

  it('tomorrow: Thursday 23:30 Dubai stays on Thursday local date -> Friday', () => {
    const result = computeDueAt(timing({ kind: 'tomorrow' }), new Date('2026-10-29T19:30:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-10-30T10:00:00+04:00', needsClarification: null });
  });

  it('tomorrow: crossing UTC midnight into Friday 00:30 Dubai -> Saturday', () => {
    const result = computeDueAt(timing({ kind: 'tomorrow' }), new Date('2026-10-29T20:30:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-10-31T10:00:00+04:00', needsClarification: null });
  });

  it('tomorrow with an explicit time overrides the 10:00 default', () => {
    const result = computeDueAt(timing({ kind: 'tomorrow', time: '16:00' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-10-31T16:00:00+04:00', needsClarification: null });
  });

  it('after_weekend from Friday -> next Monday', () => {
    const result = computeDueAt(timing({ kind: 'after_weekend' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-02T10:00:00+04:00', needsClarification: null });
  });

  it('after_weekend from Saturday -> the same upcoming Monday', () => {
    const result = computeDueAt(timing({ kind: 'after_weekend' }), new Date('2026-10-31T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-02T10:00:00+04:00', needsClarification: null });
  });

  it('after_weekend from Sunday -> the same upcoming Monday', () => {
    const result = computeDueAt(timing({ kind: 'after_weekend' }), new Date('2026-11-01T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-02T10:00:00+04:00', needsClarification: null });
  });

  it('after_weekend from Monday -> strictly the following Monday, a week later', () => {
    const result = computeDueAt(timing({ kind: 'after_weekend' }), new Date('2026-11-02T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-09T10:00:00+04:00', needsClarification: null });
  });

  it('weekday: next Thursday strictly after a Thursday sentAt is a week later', () => {
    const result = computeDueAt(timing({ kind: 'weekday', weekday: 'thu' }), new Date('2026-10-29T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-05T10:00:00+04:00', needsClarification: null });
  });

  it('in_days: 3 days after the local sentAt date', () => {
    const result = computeDueAt(timing({ kind: 'in_days', days: 3 }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-11-02T10:00:00+04:00', needsClarification: null });
  });

  it('today with an explicit time', () => {
    const result = computeDueAt(timing({ kind: 'today', time: '18:00' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: '2026-10-30T18:00:00+04:00', needsClarification: null });
  });

  it('today with no time given has no dueAt and needs clarification', () => {
    const result = computeDueAt(timing({ kind: 'today' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result.dueAt).toBeNull();
    expect(result.needsClarification).toBeTruthy();
  });

  it('unclear with raw text includes it in the clarification', () => {
    const result = computeDueAt(timing({ kind: 'unclear', raw: 'sometime next week' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result.dueAt).toBeNull();
    expect(result.needsClarification).toContain('sometime next week');
  });

  it('unclear with no raw text falls back to a generic clarification', () => {
    const result = computeDueAt(timing({ kind: 'unclear' }), new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: null, needsClarification: "The lead's timing is unclear." });
  });

  it('null timing has no dueAt and a generic clarification', () => {
    const result = computeDueAt(null, new Date('2026-10-30T08:00:00Z'), TZ);
    expect(result).toEqual({ dueAt: null, needsClarification: 'The lead did not say when to follow up.' });
  });
});
