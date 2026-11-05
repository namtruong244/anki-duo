export type StreakStatus = 'met' | 'at_risk' | 'broken';

const DAY_MS = 86_400_000;
const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/** A study day is met when the XP goal is reached, or every available card was studied (FR-025). */
export const goalMet = (d: { xp: number; goalXp: number; allAvailableDone: boolean }): boolean =>
  d.xp >= d.goalXp || d.allAvailableDone;

/** Sorted, unique day numbers up to and including today; later days are ignored. */
function met(metDays: readonly string[], today: string): number[] {
  const t = dayNumber(today);
  return [...new Set(metDays.map(dayNumber))].filter((n) => n <= t).sort((a, b) => a - b);
}

/**
 * Consecutive met days ending yesterday, plus today if it is met. A day that is still open and
 * unmet does not break the streak; a full missed day does (Story 4 #3, #4).
 */
export function currentStreak(metDays: readonly string[], today: string): number {
  const days = new Set(met(metDays, today));
  const t = dayNumber(today);
  let n = days.has(t) ? t : t - 1;
  let count = 0;
  while (days.has(n)) {
    count++;
    n--;
  }
  return count;
}

/** The longest run of consecutive met days, never lower than the stored best. */
export function longestStreak(
  metDays: readonly string[],
  today: string,
  previousLongest = 0,
): number {
  let best = previousLongest;
  let run = 0;
  let prev: number | null = null;
  for (const n of met(metDays, today)) {
    run = prev !== null && n === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = n;
  }
  return best;
}

export function streakStatus(metDays: readonly string[], today: string): StreakStatus {
  const days = new Set(met(metDays, today));
  const t = dayNumber(today);
  if (days.has(t)) return 'met';
  return days.has(t - 1) ? 'at_risk' : 'broken';
}
