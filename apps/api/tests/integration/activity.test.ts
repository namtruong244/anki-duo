import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import { createCard, createDeck, createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

// "Now" in the harness is 2026-03-01T12:00Z; the learner is in UTC with a 04:00 day start.
let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
let deckId: string;
const sessionId = randomUUID();
const deviceId = randomUUID();
const fsrs = {
  state: 'new',
  due: '2026-01-01T00:00:00.000Z',
  stability: 0,
  difficulty: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  lastReview: null,
};

beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
  deckId = (await createDeck(t.db, userId)).id;
});
afterEach(() => t.close());

/** Reviews a fresh card at `at`. Returns the review id. */
async function review(at: string, grade = 3): Promise<string> {
  const card = await createCard(t.db, userId, deckId, {
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });
  const id = randomUUID();
  const res = await h.call(userId, '/sync/push', {
    method: 'POST',
    json: {
      deviceId,
      events: [
        {
          type: 'review',
          id,
          cardId: card.id,
          sessionId,
          grade,
          reviewedAt: at,
          durationMs: 1000,
          schedulerVersion: 'x',
          stateBefore: fsrs,
          stateAfter: fsrs,
        },
      ],
    },
  });
  expect(((await res.json()) as { results: { status: string }[] }).results[0]!.status).toBe(
    'applied',
  );
  return id;
}
const push = async (events: unknown[]) =>
  (await h.call(userId, '/sync/push', { method: 'POST', json: { deviceId, events } })).json();
const day = async (d: string) =>
  (
    await t.db
      .select()
      .from(schema.dailyActivity)
      .where(and(eq(schema.dailyActivity.userId, userId), eq(schema.dailyActivity.studyDay, d)))
  )[0];
const stats = async () =>
  (await t.db.select().from(schema.learnerStats).where(eq(schema.learnerStats.userId, userId)))[0]!;
const reviewsOn = async (d: string, n: number, hour = 10) => {
  const ids: string[] = [];
  for (let i = 0; i < n; i++)
    ids.push(
      await review(
        `${d}T${String(hour).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
      ),
    );
  return ids;
};

describe('daily activity recompute', () => {
  it('counts reviews and XP for the study day, with a snapshot of the goal', async () => {
    await reviewsOn('2026-03-01', 3);
    expect(await day('2026-03-01')).toMatchObject({
      reviews: 3,
      xp: 6,
      goalXp: 20,
      goalMet: false,
      allAvailableDone: false,
    });
  });

  it('the goal is met at xp >= goal_xp', async () => {
    await reviewsOn('2026-03-01', 9);
    expect((await day('2026-03-01'))!.goalMet).toBe(false);
    await reviewsOn('2026-03-01', 1);
    expect(await day('2026-03-01')).toMatchObject({ reviews: 10, xp: 20, goalMet: true });
  });

  it('uses the 04:00 day start: 03:59 belongs to the previous study day', async () => {
    await review('2026-03-01T03:59:00.000Z');
    await review('2026-03-01T04:00:00.000Z');
    expect((await day('2026-02-28'))!.reviews).toBe(1);
    expect((await day('2026-03-01'))!.reviews).toBe(1);
  });

  it('honours the learner time zone', async () => {
    await t.db
      .update(schema.learnerSettings)
      .set({ timeZone: 'Asia/Ho_Chi_Minh' })
      .where(eq(schema.learnerSettings.userId, userId));
    await review('2026-02-28T20:59:00.000Z'); // 03:59 in Ho Chi Minh on Mar 1 -> study day Feb 28
    await review('2026-02-28T21:00:00.000Z'); // 04:00 -> study day Mar 1
    expect((await day('2026-02-28'))!.reviews).toBe(1);
    expect((await day('2026-03-01'))!.reviews).toBe(1);
  });

  it("adds the session bonus to the session's study day", async () => {
    await reviewsOn('2026-03-01', 2);
    await push([
      {
        type: 'session',
        id: randomUUID(),
        deckId,
        kind: 'review',
        nodeIndex: null,
        startedAt: '2026-03-01T09:00:00.000Z',
        endedAt: '2026-03-01T09:05:00.000Z',
        plannedCount: 2,
        cardsReviewed: 2,
        correctCount: 2,
        completed: true,
      },
    ]);
    expect(await day('2026-03-01')).toMatchObject({ reviews: 2, xp: 4 + 5 });
  });

  it('an ahead session earns no bonus and study-ahead reviews earn no XP', async () => {
    await push([
      {
        type: 'session',
        id: randomUUID(),
        deckId,
        kind: 'ahead',
        nodeIndex: null,
        startedAt: '2026-03-01T09:00:00.000Z',
        endedAt: '2026-03-01T09:05:00.000Z',
        plannedCount: 1,
        cardsReviewed: 1,
        correctCount: 1,
        completed: true,
      },
    ]);
    expect((await day('2026-03-01'))?.xp ?? 0).toBe(0);
  });

  it('a day_flag sets all_available_done and meets the goal', async () => {
    await push([
      { type: 'day_flag', id: randomUUID(), studyDay: '2026-03-01', allAvailableDone: true },
    ]);
    expect(await day('2026-03-01')).toMatchObject({ allAvailableDone: true, goalMet: true, xp: 0 });
    await reviewsOn('2026-03-01', 1);
    expect(await day('2026-03-01')).toMatchObject({
      allAvailableDone: true,
      goalMet: true,
      reviews: 1,
      xp: 2,
    });
  });

  it('a revoke reverses the XP and the review count (Story 1 #4)', async () => {
    const ids = await reviewsOn('2026-03-01', 10);
    expect((await day('2026-03-01'))!.goalMet).toBe(true);
    await push([
      { type: 'revoke', id: randomUUID(), reviewId: ids[0], revokedAt: '2026-03-01T11:00:00.000Z' },
    ]);
    expect(await day('2026-03-01')).toMatchObject({ reviews: 9, xp: 18, goalMet: false });
    expect((await stats()).totalXp).toBe(18);
  });

  it('keeps the goal snapshot of past days but follows the setting for today', async () => {
    await review('2026-02-20T10:00:00.000Z');
    await t.db
      .update(schema.learnerSettings)
      .set({ dailyXpGoal: 10 })
      .where(eq(schema.learnerSettings.userId, userId));
    await review('2026-02-20T10:05:00.000Z');
    await review('2026-03-01T10:00:00.000Z');
    expect((await day('2026-02-20'))!.goalXp).toBe(20);
    expect((await day('2026-03-01'))!.goalXp).toBe(10);
  });

  it('an out-of-order review recomputes its own, earlier day', async () => {
    await review('2026-03-01T10:00:00.000Z');
    await review('2026-02-27T10:00:00.000Z');
    expect((await day('2026-02-27'))!.reviews).toBe(1);
    expect((await day('2026-03-01'))!.reviews).toBe(1);
  });
});

describe('learner stats', () => {
  it('total_xp, current_streak, longest_streak and last_goal_day', async () => {
    await t.db
      .update(schema.learnerSettings)
      .set({ dailyXpGoal: 10 })
      .where(eq(schema.learnerSettings.userId, userId));
    await reviewsOn('2026-02-20', 5); // run of 1
    await reviewsOn('2026-02-26', 5);
    await reviewsOn('2026-02-27', 5);
    await reviewsOn('2026-02-28', 5); // run of 3 ending yesterday
    const s = await stats();
    expect(s).toMatchObject({
      totalXp: 40,
      currentStreak: 3,
      longestStreak: 3,
      lastGoalDay: '2026-02-28',
    });
    await reviewsOn('2026-03-01', 5); // today met
    expect(await stats()).toMatchObject({
      totalXp: 50,
      currentStreak: 4,
      longestStreak: 4,
      lastGoalDay: '2026-03-01',
    });
  });

  it('a missed day resets the current streak but never lowers the longest', async () => {
    await t.db
      .update(schema.learnerSettings)
      .set({ dailyXpGoal: 10 })
      .where(eq(schema.learnerSettings.userId, userId));
    await reviewsOn('2026-02-23', 5);
    await reviewsOn('2026-02-24', 5);
    await reviewsOn('2026-02-25', 5);
    // Feb 26, 27, 28 missed; today is Mar 1 and nothing is met yet
    await reviewsOn('2026-03-01', 1);
    expect(await stats()).toMatchObject({ currentStreak: 0, longestStreak: 3 });
  });

  it('a stored longest streak is never lowered', async () => {
    await t.db
      .update(schema.learnerStats)
      .set({ longestStreak: 30 })
      .where(eq(schema.learnerStats.userId, userId));
    await reviewsOn('2026-03-01', 10);
    expect(await stats()).toMatchObject({ currentStreak: 1, longestStreak: 30 });
  });

  it('daily activity shows up in pull', async () => {
    await reviewsOn('2026-03-01', 2);
    const pulled = (await (
      await h.call(userId, `/sync/pull?cursor=0&deviceId=${deviceId}`)
    ).json()) as {
      dailyActivity: { studyDay: string; reviews: number }[];
      stats: { totalXp: number };
    };
    expect(pulled.dailyActivity).toMatchObject([{ studyDay: '2026-03-01', reviews: 2 }]);
    expect(pulled.stats.totalXp).toBe(4);
  });
});
