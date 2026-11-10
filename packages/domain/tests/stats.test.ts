import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { classifyCard, donutCounts, todayWorkload, type StatCard } from '../src/stats/donut.js';
import { heatmapBuckets } from '../src/stats/heatmap.js';

interface Case {
  name: string;
  studyDayEnd: string;
  decks: { id: string; newCardsPerDay: number; introducedToday: number }[];
  cards: (Omit<StatCard, 'due'> & { due: string })[];
  expected: { counts: Record<string, number>; centre: number };
}
const { cases } = loadFixture<{ cases: Case[] }>('donut');
const hydrate = (c: Case) => c.cards.map((x) => ({ ...x, due: new Date(x.due) }));

describe('donut (fixtures/donut.json)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const cards = hydrate(c);
      const end = new Date(c.studyDayEnd);
      expect(donutCounts(cards, end)).toEqual(c.expected.counts);
      expect(todayWorkload(cards, c.decks, end)).toBe(c.expected.centre);
    });
  }

  it('classifyCard checks Suspended, New, Learning, Due, then Not due', () => {
    const end = new Date('2026-03-01T21:00:00Z');
    const c = (state: StatCard['state'], suspended = false): StatCard => ({
      id: 'x',
      deckId: 'd',
      state,
      due: new Date('2026-01-01'),
      suspended,
    });
    expect(classifyCard(c('review', true), end)).toBe('suspended');
    expect(classifyCard(c('new'), end)).toBe('new');
    expect(classifyCard(c('relearning'), end)).toBe('learning');
    expect(classifyCard(c('review'), end)).toBe('due');
  });

  it('the segments always sum to the card count', () => {
    const state = fc.constantFrom('new', 'learning', 'review', 'relearning' as const);
    const card = fc.record({
      id: fc.uuid(),
      deckId: fc.constantFrom('a', 'b'),
      state,
      due: fc.date({
        min: new Date('2025-01-01'),
        max: new Date('2027-01-01'),
        noInvalidDate: true,
      }),
      suspended: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(card, { maxLength: 200 }), (cards) => {
        const counts = donutCounts(cards as StatCard[], new Date('2026-03-01T21:00:00Z'));
        expect(counts.suspended + counts.new + counts.learning + counts.due + counts.notDue).toBe(
          cards.length,
        );
      }),
    );
  });
});

describe('heatmapBuckets', () => {
  const today = '2026-03-10';

  it('covers the calendar year of today (Jan 1 to Dec 31), oldest first', () => {
    const cells = heatmapBuckets([], today);
    expect(cells).toHaveLength(365);
    expect(cells[0]!.date).toBe('2026-01-01');
    expect(cells.at(-1)!.date).toBe('2026-12-31');
    expect(cells.every((c) => c.reviews === 0 && c.level === 0)).toBe(true);
  });

  it('marks only days after today as future', () => {
    const cells = heatmapBuckets([], today);
    const byDate = (d: string) => cells.find((c) => c.date === d)!;
    expect(byDate(today).future).toBeUndefined();
    expect(byDate('2026-03-11').future).toBe(true);
    expect(byDate('2026-03-11').reviews).toBe(0);
    expect(cells.filter((c) => c.future).length).toBe(365 - 69); // Mar 11 .. Dec 31
  });

  it('covers 366 days in a leap year', () => {
    const cells = heatmapBuckets([], '2028-06-01');
    expect(cells).toHaveLength(366);
    expect(cells[0]!.date).toBe('2028-01-01');
    expect(cells.at(-1)!.date).toBe('2028-12-31');
  });

  it('ignores activity dated after today within the year', () => {
    const cells = heatmapBuckets(
      [
        { studyDay: '2026-03-09', reviews: 4 },
        { studyDay: '2026-03-20', reviews: 50 },
      ],
      today,
    );
    expect(cells.find((c) => c.date === '2026-03-20')!.reviews).toBe(0);
    expect(cells.find((c) => c.date === '2026-03-09')!.level).toBe(4);
    expect(cells.every((c) => !c.future || (c.reviews === 0 && c.level === 0))).toBe(true);
  });

  it('uses 5 intensity levels relative to the busiest day', () => {
    const cells = heatmapBuckets(
      [
        { studyDay: '2026-03-01', reviews: 20 },
        { studyDay: '2026-03-02', reviews: 10 },
        { studyDay: '2026-03-03', reviews: 5 },
        { studyDay: '2026-03-04', reviews: 1 },
        { studyDay: '2026-03-05', reviews: 15 },
      ],
      today,
    );
    const level = (d: string) => cells.find((c) => c.date === d)!.level;
    expect([
      level('2026-03-01'),
      level('2026-03-02'),
      level('2026-03-03'),
      level('2026-03-04'),
      level('2026-03-05'),
      level('2026-03-06'),
    ]).toEqual([4, 2, 1, 1, 3, 0]);
  });

  it('ignores days outside the window and sums duplicates', () => {
    const cells = heatmapBuckets(
      [
        { studyDay: '2020-01-01', reviews: 999 },
        { studyDay: '2026-03-09', reviews: 3 },
        { studyDay: '2026-03-09', reviews: 2 },
      ],
      today,
    );
    expect(cells.find((c) => c.date === '2026-03-09')!.reviews).toBe(5);
    expect(Math.max(...cells.map((c) => c.level))).toBe(4); // scaled by 5, not by the ignored 999
  });
});
