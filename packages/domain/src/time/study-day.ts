const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(instant: Date, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(instant))
    if (type !== 'literal') p[type] = Number(value);
  return p as {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  };
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The study day (`YYYY-MM-DD`) an instant belongs to: the local calendar date after moving the
 * wall clock back by `dayStartHour` (research R14).
 */
export function studyDay(instant: Date, timeZone: string, dayStartHour: number): string {
  const p = parts(instant, timeZone);
  // Wall-clock arithmetic on a UTC-labelled date: no DST involved.
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour - dayStartHour, p.minute, p.second);
  return isoDay(wall);
}

/** The instant the given study day ends (and the next begins). */
export function endOfStudyDay(day: string, timeZone: string, dayStartHour: number): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = Date.UTC(y, m - 1, d + 1, dayStartHour, 0, 0);
  return wallClockToInstant(next, timeZone);
}

/** Converts a wall-clock time (as UTC-labelled ms) in `timeZone` to the real instant. */
function wallClockToInstant(wallMs: number, timeZone: string): Date {
  // Start from the naive guess and correct by the zone offset at that guess, twice for DST edges.
  let guess = wallMs;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = wallMs - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}
