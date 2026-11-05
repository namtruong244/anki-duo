export interface HeatmapCell {
  date: string;
  reviews: number;
  /** 0 = no reviews, 1-4 = increasing intensity. */
  level: 0 | 1 | 2 | 3 | 4;
}

const DAY_MS = 86_400_000;
export const HEATMAP_DAYS = 365;

/**
 * One cell per day for the last 12 months ending `today`, oldest first. Intensity is relative to
 * the busiest day in the window: `ceil(4 * reviews / max)`.
 */
export function heatmapBuckets(
  activity: readonly { studyDay: string; reviews: number }[],
  today: string,
): HeatmapCell[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  const byDay = new Map<string, number>();
  for (const a of activity) byDay.set(a.studyDay, (byDay.get(a.studyDay) ?? 0) + a.reviews);

  const cells: HeatmapCell[] = [];
  for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
    const date = new Date(end - i * DAY_MS).toISOString().slice(0, 10);
    cells.push({ date, reviews: byDay.get(date) ?? 0, level: 0 });
  }
  const max = Math.max(0, ...cells.map((c) => c.reviews));
  for (const c of cells)
    c.level =
      c.reviews === 0 ? 0 : (Math.min(4, Math.ceil((4 * c.reviews) / max)) as HeatmapCell['level']);
  return cells;
}
