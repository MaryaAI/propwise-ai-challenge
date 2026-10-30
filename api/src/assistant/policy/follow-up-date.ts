import { DateTime } from 'luxon';
import { FollowUpTiming, Weekday } from '../types';

const WEEKDAY_NUMBERS: Record<Weekday, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

function atTime(date: DateTime, time: string | null): DateTime {
  if (time === null) return date.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const [hour, minute] = time.split(':').map(Number);
  return date.set({ hour, minute, second: 0, millisecond: 0 });
}

function toIso(date: DateTime): string {
  const iso = date.toISO({ suppressMilliseconds: true });
  if (iso === null) throw new Error('Invalid DateTime produced by computeDueAt');
  return iso;
}

function firstAfter(from: DateTime, matches: (d: DateTime) => boolean): DateTime {
  let d = from.plus({ days: 1 });
  while (!matches(d)) d = d.plus({ days: 1 });
  return d;
}

export function computeDueAt(
  timing: FollowUpTiming | null,
  sentAt: Date,
  timeZone: string,
): { dueAt: string | null; needsClarification: string | null } {
  if (timing === null) {
    return { dueAt: null, needsClarification: 'The lead did not say when to follow up.' };
  }

  const anchor = DateTime.fromJSDate(sentAt, { zone: timeZone }).startOf('day');

  switch (timing.kind) {
    case 'tomorrow':
      return { dueAt: toIso(atTime(anchor.plus({ days: 1 }), timing.time)), needsClarification: null };

    case 'today':
      if (timing.time === null) {
        return { dueAt: null, needsClarification: 'The lead did not say what time today.' };
      }
      return { dueAt: toIso(atTime(anchor, timing.time)), needsClarification: null };

    case 'after_weekend':
      return { dueAt: toIso(atTime(firstAfter(anchor, (d) => d.weekday === 1), timing.time)), needsClarification: null };

    case 'weekday': {
      if (timing.weekday === null) {
        return { dueAt: null, needsClarification: 'The lead did not say which weekday.' };
      }
      const target = WEEKDAY_NUMBERS[timing.weekday];
      return { dueAt: toIso(atTime(firstAfter(anchor, (d) => d.weekday === target), timing.time)), needsClarification: null };
    }

    case 'in_days':
      if (timing.days === null) {
        return { dueAt: null, needsClarification: 'The lead did not say how many days.' };
      }
      return { dueAt: toIso(atTime(anchor.plus({ days: timing.days }), timing.time)), needsClarification: null };

    case 'unclear':
      return { dueAt: null, needsClarification: timing.raw ?? "The lead's timing is unclear." };
  }
}
