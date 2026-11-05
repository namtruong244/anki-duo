export type IntervalUnit = 'lessThanMinute' | 'minutes' | 'hours' | 'days' | 'months' | 'years';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Splits a duration into the largest sensible unit, e.g. 3 days or 10 minutes. */
export function intervalParts(ms: number): { unit: IntervalUnit; n: number } {
  if (ms < MIN) return { unit: 'lessThanMinute', n: 0 };
  if (ms < HOUR) return { unit: 'minutes', n: Math.round(ms / MIN) };
  if (ms < DAY) return { unit: 'hours', n: Math.round(ms / HOUR) };
  if (ms < 30 * DAY) return { unit: 'days', n: Math.round(ms / DAY) };
  if (ms < 365 * DAY) return { unit: 'months', n: Math.round(ms / (30 * DAY)) };
  return { unit: 'years', n: Math.max(1, Math.round(ms / (365 * DAY))) };
}

export function intervalLabel(
  ms: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  const { unit, n } = intervalParts(ms);
  return t(`interval.${unit}`, { n });
}
