import { beforeEach, describe, expect, it } from 'vitest';
import { DexieStore } from '../../src/client/dexie-store';
import { adjustToday, queueDayFlagIfDone } from '../../src/client/gamification';
import type { Card, Settings } from '../../src/client/local-store';

const settings: Settings = {
  locale: 'en',
  timeZone: 'UTC',
  dayStartHour: 4,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  dailyXpGoal: 20,
  sessionSize: 20,
  soundEnabled: true,
  motion: 'system',
};
const NOW = new Date('2026-03-10T12:00:00Z');
const TODAY = '2026-03-10';

const card = (
  id: string,
  state: Card['fsrs']['state'],
  due: string,
  over: Partial<Card> = {},
): Card => ({
  id,
  deckId: 'd1',
  position: 0,
  nodeIndex: 0,
  front: 'f',
  back: '',
  tags: [],
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  format: 'markdown' as const,
  fsrs: {
    state,
    due,
    stability: 1,
    difficulty: 5,
    learningSteps: 0,
    reps: 1,
    lapses: 0,
    lastReview: null,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  ...over,
});

let store: DexieStore;
const ctx = () => ({ store, userId: 'u', settings, now: NOW });

beforeEach(async () => {
  store = new DexieStore(`gam-${Math.random()}`);
  await store.setMeta('userId', 'u');
  await store.putDecks([
    { id: 'd1', name: 'D', newCardsPerDay: 2, createdAt: 'x', updatedAt: 'x', deletedAt: null },
  ]);
});

describe('adjustToday (optimistic XP and streak)', () => {
  it('updates the day row and the stats immediately', async () => {
    const r = await adjustToday(ctx(), { reviews: 1, xp: 2 });
    expect(r.goalCrossed).toBe(false);
    expect(await store.listDailyActivity()).toMatchObject([
      { studyDay: TODAY, reviews: 1, xp: 2, goalXp: 20, goalMet: false },
    ]);
    expect(await store.getStats('u')).toMatchObject({ totalXp: 2, currentStreak: 0 });
  });

  it('reports the moment the goal is crossed and the streak goes up', async () => {
    await store.putDailyActivity([
      {
        studyDay: '2026-03-09',
        reviews: 10,
        xp: 20,
        goalXp: 20,
        allAvailableDone: false,
        goalMet: true,
      },
    ]);
    await adjustToday(ctx(), { reviews: 9, xp: 18 });
    const r = await adjustToday(ctx(), { reviews: 1, xp: 2 });
    expect(r).toMatchObject({ goalCrossed: true, streak: 2, streakIncreased: true });
    expect(await store.getStats('u')).toMatchObject({
      currentStreak: 2,
      longestStreak: 2,
      lastGoalDay: TODAY,
    });
    // Further XP does not celebrate again.
    expect((await adjustToday(ctx(), { reviews: 1, xp: 2 })).goalCrossed).toBe(false);
  });

  it('a negative adjustment (undo) takes XP back and can un-meet the goal', async () => {
    await adjustToday(ctx(), { reviews: 10, xp: 20 });
    await adjustToday(ctx(), { reviews: -1, xp: -2 });
    expect(await store.listDailyActivity()).toMatchObject([{ reviews: 9, xp: 18, goalMet: false }]);
    expect((await store.getStats('u'))!.totalXp).toBe(18);
  });

  it('never lowers the longest streak', async () => {
    await store.putStats('u', {
      totalXp: 0,
      currentStreak: 0,
      longestStreak: 9,
      lastGoalDay: null,
      cardCount: 0,
      mediaBytes: 0,
    });
    await adjustToday(ctx(), { reviews: 1, xp: 2 });
    expect((await store.getStats('u'))!.longestStreak).toBe(9);
  });
});

describe('queueDayFlagIfDone (FR-025)', () => {
  it('queues one DayFlagEvent when nothing is left to study today', async () => {
    await store.putCards([card('a', 'review', '2026-03-20T00:00:00.000Z')]);
    await adjustToday(ctx(), { reviews: 1, xp: 2 });
    let n = 0;
    const id = () => `flag-${++n}`;
    expect(await queueDayFlagIfDone(ctx(), id)).toBe(true);
    expect(await store.listOutbox()).toMatchObject([
      { type: 'day_flag', id: 'flag-1', studyDay: TODAY, allAvailableDone: true },
    ]);
    expect(await store.listDailyActivity()).toMatchObject([
      { allAvailableDone: true, goalMet: true },
    ]);
    // Only once per study day.
    expect(await queueDayFlagIfDone(ctx(), id)).toBe(false);
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it('does not queue while a card is still due', async () => {
    await store.putCards([card('a', 'review', '2026-03-10T08:00:00.000Z')]);
    await adjustToday(ctx(), { reviews: 1, xp: 2 });
    expect(await queueDayFlagIfDone(ctx(), () => 'x')).toBe(false);
  });

  it('does not queue while new cards are still allowed today', async () => {
    await store.putCards([
      card('n', 'new', '2026-03-01T00:00:00.000Z', {
        fsrs: { ...card('n', 'new', 'x').fsrs, reps: 0 },
      }),
    ]);
    await adjustToday(ctx(), { reviews: 1, xp: 2 });
    expect(await queueDayFlagIfDone(ctx(), () => 'x')).toBe(false);
  });

  it('queues when the new-card allowance is used up', async () => {
    const fresh = (id: string) =>
      card(id, 'new', '2026-03-01T00:00:00.000Z', {
        fsrs: { ...card(id, 'new', 'x').fsrs, reps: 0 },
      });
    // Two cards introduced today use the allowance of 2; a third new card is waiting.
    const introduced = (id: string) =>
      card(id, 'review', '2026-03-20T00:00:00.000Z', {
        fsrs: { ...card(id, 'review', 'x').fsrs, reps: 1, lastReview: '2026-03-10T09:00:00.000Z' },
      });
    await store.putCards([introduced('i1'), introduced('i2'), fresh('n')]);
    await adjustToday(ctx(), { reviews: 2, xp: 4 });
    expect(await queueDayFlagIfDone(ctx(), () => 'f')).toBe(true);
  });

  it('does not queue before anything was studied today', async () => {
    await store.putCards([card('a', 'review', '2026-03-20T00:00:00.000Z')]);
    expect(await queueDayFlagIfDone(ctx(), () => 'x')).toBe(false);
  });
});
