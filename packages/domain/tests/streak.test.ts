import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { currentStreak, goalMet, longestStreak, streakStatus } from '../src/gamification/streak.js';
import { studyDay } from '../src/time/study-day.js';

interface Fixture {
  goalMet: { xp: number; goalXp: number; allAvailableDone: boolean; expected: boolean }[];
  cases: {
    name: string;
    today: string;
    metDays: string[];
    previousLongest: number;
    expected: { current: number; longest: number; status: string };
  }[];
  fromEvents: {
    name: string;
    timeZone: string;
    dayStartHour: number;
    goalXp: number;
    events: { at: string; xp: number }[];
    now: string;
    expected: { current: number; status: string };
  }[];
}
const fx = loadFixture<Fixture>('streak');

describe('goalMet', () => {
  for (const c of fx.goalMet) {
    it(`xp ${c.xp} / goal ${c.goalXp}${c.allAvailableDone ? ' + all available done' : ''} -> ${c.expected}`, () =>
      expect(goalMet({ xp: c.xp, goalXp: c.goalXp, allAvailableDone: c.allAvailableDone })).toBe(
        c.expected,
      ));
  }
});

describe('streaks (fixtures/streak.json)', () => {
  for (const c of fx.cases) {
    it(c.name, () => {
      expect(currentStreak(c.metDays, c.today)).toBe(c.expected.current);
      expect(longestStreak(c.metDays, c.today, c.previousLongest)).toBe(c.expected.longest);
      expect(streakStatus(c.metDays, c.today)).toBe(c.expected.status);
    });
  }

  for (const c of fx.fromEvents) {
    it(c.name, () => {
      const xpByDay = new Map<string, number>();
      for (const e of c.events) {
        const day = studyDay(new Date(e.at), c.timeZone, c.dayStartHour);
        xpByDay.set(day, (xpByDay.get(day) ?? 0) + e.xp);
      }
      const met = [...xpByDay]
        .filter(([, xp]) => goalMet({ xp, goalXp: c.goalXp, allAvailableDone: false }))
        .map(([d]) => d);
      const today = studyDay(new Date(c.now), c.timeZone, c.dayStartHour);
      expect(currentStreak(met, today)).toBe(c.expected.current);
      expect(streakStatus(met, today)).toBe(c.expected.status);
    });
  }

  it('does not mutate its input', () => {
    const days = ['2026-03-02', '2026-03-01'];
    currentStreak(days, '2026-03-02');
    expect(days).toEqual(['2026-03-02', '2026-03-01']);
  });
});
