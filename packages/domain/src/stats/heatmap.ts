export interface HeatmapCell {
  date: string;
  reviews: number;
  /** 0 = no reviews, 1-4 = increasing intensity. */
  level: 0 | 1 | 2 | 3 | 4;
  /** True for days after `today`; always reviews 0, level 0. */
  future?: boolean;
}

const DAY_MS = 86_400_000;

/**
 * One cell per day of the calendar year containing `today` (Jan 1 to Dec 31), oldest first.
 * Days after `today` are marked `future` and carry no reviews. Activity outside [Jan 1, today]
 * is ignored. Intensity is relative to the busiest day in the window: `ceil(4 * reviews / max)`.
 */
export function heatmapBuckets(
  activity: readonly { studyDay: string; reviews: number }[],
  today: string,
): HeatmapCell[] {
  const year = today.slice(0, 4);
  const start = Date.parse(`${year}-01-01T00:00:00Z`);
  const yearEnd = Date.parse(`${year}-12-31T00:00:00Z`);

  const byDay = new Map<string, number>();
  for (const a of activity) {
    if (a.studyDay < `${year}-01-01` || a.studyDay > today) continue;
    byDay.set(a.studyDay, (byDay.get(a.studyDay) ?? 0) + a.reviews);
  }

  const cells: HeatmapCell[] = [];
  for (let t = start; t <= yearEnd; t += DAY_MS) {
    const date = new Date(t).toISOString().slice(0, 10);
    if (date > today) {
      cells.push({ date, reviews: 0, level: 0, future: true });
    } else {
      cells.push({ date, reviews: byDay.get(date) ?? 0, level: 0 });
    }
  }
  const max = Math.max(0, ...cells.map((c) => c.reviews));
  for (const c of cells)
    c.level =
      c.reviews === 0 ? 0 : (Math.min(4, Math.ceil((4 * c.reviews) / max)) as HeatmapCell['level']);
  return cells;
}
