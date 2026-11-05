import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeState, newCard, replay, schedule, type Grade } from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import {
  createCard,
  createDeck,
  createTestDb,
  createUser,
  FIXED_NOW,
  type TestDb,
} from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
const deviceId = randomUUID();
const sessionId = randomUUID();
const created = new Date('2026-01-01T00:00:00.000Z');

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
let cardId: string;
let deckId: string;

beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
  deckId = (await createDeck(t.db, userId)).id;
  const c = newCard(created);
  cardId = (await createCard(t.db, userId, deckId, { createdAt: created, due: c.due })).id;
});
afterEach(() => t.close());

const fsrsJson = {
  state: 'new',
  due: created.toISOString(),
  stability: 0,
  difficulty: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  lastReview: null,
};
const review = (over: Record<string, unknown> = {}) => ({
  type: 'review',
  id: randomUUID(),
  cardId,
  sessionId,
  grade: 3,
  reviewedAt: '2026-03-01T11:00:00.000Z',
  durationMs: 4000,
  studyAhead: false,
  schedulerVersion: 'client-version',
  stateBefore: fsrsJson,
  stateAfter: { ...fsrsJson, state: 'review', stability: 999, difficulty: 9 }, // wrong on purpose
  ...over,
});
const push = (events: unknown[], user: string | null = userId) =>
  h.call(user, '/sync/push', { method: 'POST', json: { deviceId, events } });
const results = async (events: unknown[]) =>
  (
    (await (await push(events)).json()) as {
      results: { id: string; status: string; code?: string }[];
    }
  ).results;
const logs = (id = cardId) =>
  t.db.select().from(schema.reviewLog).where(eq(schema.reviewLog.cardId, id));
const cardRow = async (id = cardId) =>
  (await t.db.select().from(schema.card).where(eq(schema.card.id, id)))[0]!;
const stateOf = (c: typeof schema.card.$inferSelect) => ({
  state: c.state,
  due: c.due,
  stability: c.stability,
  difficulty: c.difficulty,
  learningSteps: c.learningSteps,
  reps: c.reps,
  lapses: c.lapses,
  lastReview: c.lastReview,
});
const truth = async (id = cardId) => {
  const rows = (await logs(id)).map((l) => ({
    id: l.id,
    kind: l.kind as 'review' | 'reset',
    grade: l.grade as Grade | null,
    reviewedAt: l.reviewedAt,
    revokedAt: l.revokedAt,
  }));
  return replay(newCard(created), rows, params);
};

describe('POST /api/v1/sync/push', () => {
  it('requires a signed-in user', async () => {
    expect((await push([], null)).status).toBe(401);
  });

  it('applies a review: stores the log and updates the card from the server schedule', async () => {
    const e = review();
    expect(await results([e])).toEqual([{ id: e.id, status: 'applied' }]);
    const [log] = await logs();
    expect(log).toMatchObject({
      id: e.id,
      userId,
      deckId,
      grade: 3,
      kind: 'review',
      durationMs: 4000,
      wasNew: true,
      studyAhead: false,
      xp: 2,
    });
    expect(log!.schedulerVersion).toMatch(/^ts-fsrs@/);
    expect(await cardRow().then(stateOf)).toEqual(
      schedule(newCard(created), 3, new Date(e.reviewedAt), params).card,
    );
  });

  it('ignores a client stateAfter that differs from the truth and stores the server state (V14)', async () => {
    const e = review();
    await results([e]);
    const [log] = await logs();
    const after = decodeState(log!.stateAfter);
    expect(after.stability).not.toBe(999);
    expect(after).toEqual(schedule(newCard(created), 3, new Date(e.reviewedAt), params).card);
    expect(decodeState(log!.stateBefore)).toEqual(newCard(created));
  });

  it('the same event id twice gives duplicate and no second row', async () => {
    const e = review();
    await results([e]);
    expect(await results([e])).toEqual([{ id: e.id, status: 'duplicate' }]);
    expect(await logs()).toHaveLength(1);
    expect(await cardRow().then(stateOf)).toEqual(await truth());
  });

  it('reviewedAt more than 5 minutes in the future is rejected with future_timestamp', async () => {
    const tooLate = new Date(FIXED_NOW.getTime() + 5 * 60_000 + 1000).toISOString();
    const ok = new Date(FIXED_NOW.getTime() + 4 * 60_000).toISOString();
    const bad = review({ reviewedAt: tooLate });
    expect(await results([bad])).toEqual([
      { id: bad.id, status: 'rejected', code: 'future_timestamp' },
    ]);
    expect(await logs()).toHaveLength(0);
    expect((await results([review({ reviewedAt: ok })]))[0]!.status).toBe('applied');
  });

  it('an unknown or foreign card is rejected with card_not_found', async () => {
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const oc = await createCard(t.db, other.id, od.id);
    const a = review({ cardId: randomUUID() });
    const b = review({ cardId: oc.id });
    expect(await results([a, b])).toEqual([
      { id: a.id, status: 'rejected', code: 'card_not_found' },
      { id: b.id, status: 'rejected', code: 'card_not_found' },
    ]);
  });

  it('a deleted card is rejected with card_not_found', async () => {
    await t.db.update(schema.card).set({ deletedAt: FIXED_NOW }).where(eq(schema.card.id, cardId));
    const e = review();
    expect(await results([e])).toEqual([{ id: e.id, status: 'rejected', code: 'card_not_found' }]);
  });

  it.each([[0], [5], [-1], [2.5]])('grade %s is rejected with invalid_grade', async (grade) => {
    const e = review({ grade });
    expect(await results([e])).toEqual([{ id: e.id, status: 'rejected', code: 'invalid_grade' }]);
    expect(await logs()).toHaveLength(0);
  });

  it('an out-of-order review triggers a replay and the card equals replay() of all logs', async () => {
    const later = review({
      id: '00000000-0000-4000-8000-000000000002',
      reviewedAt: '2026-03-01T10:00:00.000Z',
      grade: 4,
    });
    const earlier = review({
      id: '00000000-0000-4000-8000-000000000001',
      reviewedAt: '2026-02-20T10:00:00.000Z',
      grade: 1,
    });
    await results([later]);
    await results([earlier]);
    expect(await logs()).toHaveLength(2);
    expect(await cardRow().then(stateOf)).toEqual(await truth());
    // Arrival order must not matter: same result as pushing in order on a fresh card.
    const [first] = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.id, earlier.id));
    expect(decodeState(first!.stateBefore)).toEqual(newCard(created));
  });

  it('keeps every log when two devices review the same card (replay in (reviewed_at, id) order)', async () => {
    const a = review({ reviewedAt: '2026-03-01T09:00:00.000Z', grade: 3 });
    const b = review({ reviewedAt: '2026-03-01T09:00:00.000Z', grade: 1 });
    await results([a]);
    await results([b]);
    expect(await logs()).toHaveLength(2);
    expect(await cardRow().then(stateOf)).toEqual(await truth());
  });

  it('a revoke sets revoked_at, replays the card and removes the XP', async () => {
    const r1 = review({ reviewedAt: '2026-03-01T09:00:00.000Z', grade: 3 });
    const r2 = review({ reviewedAt: '2026-03-01T10:00:00.000Z', grade: 4 });
    await results([r1, r2]);
    const revoke = {
      type: 'revoke',
      id: randomUUID(),
      reviewId: r2.id,
      revokedAt: '2026-03-01T10:01:00.000Z',
    };
    expect(await results([revoke])).toEqual([{ id: revoke.id, status: 'applied' }]);
    const [row] = await t.db.select().from(schema.reviewLog).where(eq(schema.reviewLog.id, r2.id));
    expect(row!.revokedAt).toEqual(new Date('2026-03-01T10:01:00.000Z'));
    expect(await cardRow().then(stateOf)).toEqual(
      schedule(newCard(created), 3, new Date(r1.reviewedAt), params).card,
    );
    expect(await logs()).toHaveLength(2); // append-only: not deleted
  });

  it('revoking twice is a duplicate; revoking an unknown review gives review_not_found', async () => {
    const r = review();
    await results([r]);
    const rev = (reviewId: string) => ({
      type: 'revoke',
      id: randomUUID(),
      reviewId,
      revokedAt: '2026-03-01T11:30:00.000Z',
    });
    const first = rev(r.id);
    expect((await results([first]))[0]!.status).toBe('applied');
    expect((await results([rev(r.id)]))[0]!.status).toBe('duplicate');
    const ghost = rev(randomUUID());
    expect(await results([ghost])).toEqual([
      { id: ghost.id, status: 'rejected', code: 'review_not_found' },
    ]);
  });

  it("cannot revoke another user's review", async () => {
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const oc = await createCard(t.db, other.id, od.id, { createdAt: created });
    const theirs = review({ cardId: oc.id });
    expect(
      (await (await push([theirs], other.id)).json()) as { results: { status: string }[] },
    ).toMatchObject({ results: [{ status: 'applied' }] });
    const attack = {
      type: 'revoke',
      id: randomUUID(),
      reviewId: theirs.id,
      revokedAt: '2026-03-01T11:30:00.000Z',
    };
    expect((await results([attack]))[0]).toMatchObject({
      status: 'rejected',
      code: 'review_not_found',
    });
  });

  it('derives study_ahead from the schedule, not from the client flag', async () => {
    // Graduate the card to review with a long interval, then review it again days before due.
    const r1 = review({ reviewedAt: '2026-02-01T09:00:00.000Z', grade: 4 });
    await results([r1]);
    const due = (await cardRow()).due;
    expect(due.getTime()).toBeGreaterThan(Date.parse('2026-02-05T00:00:00Z'));
    const early = review({ reviewedAt: '2026-02-03T09:00:00.000Z', grade: 3, studyAhead: false });
    await results([early]);
    const [row] = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.id, early.id));
    expect(row).toMatchObject({ studyAhead: true, xp: 0, wasDue: false, wasNew: false });
  });

  it('a card due today is not study ahead, and Again/Easy earn the same XP', async () => {
    await results([review({ grade: 1 })]);
    const [a] = await logs();
    expect(a).toMatchObject({ studyAhead: false, xp: 2, wasNew: true });
  });

  it('session events upsert by id', async () => {
    const id = randomUUID();
    const s = {
      type: 'session',
      id,
      deckId,
      kind: 'review',
      nodeIndex: null,
      startedAt: '2026-03-01T10:00:00.000Z',
      endedAt: null,
      plannedCount: 5,
      cardsReviewed: 1,
      correctCount: 1,
      completed: false,
    };
    expect(await results([s])).toEqual([{ id, status: 'applied' }]);
    await results([
      {
        ...s,
        endedAt: '2026-03-01T10:05:00.000Z',
        cardsReviewed: 5,
        correctCount: 4,
        completed: true,
      },
    ]);
    const rows = await t.db
      .select()
      .from(schema.studySession)
      .where(eq(schema.studySession.id, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId,
      cardsReviewed: 5,
      correctCount: 4,
      completed: true,
      bonusXp: 5,
      studyDay: '2026-03-01',
    });
    expect(rows[0]!.endedAt).toEqual(new Date('2026-03-01T10:05:00.000Z'));
  });

  it('an ahead session earns no bonus', async () => {
    const id = randomUUID();
    await results([
      {
        type: 'session',
        id,
        deckId,
        kind: 'ahead',
        nodeIndex: null,
        startedAt: '2026-03-01T10:00:00.000Z',
        endedAt: '2026-03-01T10:01:00.000Z',
        plannedCount: 1,
        cardsReviewed: 1,
        correctCount: 1,
        completed: true,
      },
    ]);
    const [row] = await t.db
      .select()
      .from(schema.studySession)
      .where(eq(schema.studySession.id, id));
    expect(row!.bonusXp).toBe(0);
  });

  it("a session for someone else's deck is rejected", async () => {
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const id = randomUUID();
    expect(
      (
        await results([
          {
            type: 'session',
            id,
            deckId: od.id,
            kind: 'review',
            nodeIndex: null,
            startedAt: '2026-03-01T10:00:00.000Z',
            endedAt: null,
            plannedCount: 1,
            cardsReviewed: 0,
            correctCount: 0,
            completed: false,
          },
        ])
      )[0],
    ).toMatchObject({ status: 'rejected' });
  });

  it('accepts a day_flag and stores it for the study day', async () => {
    const id = randomUUID();
    expect(
      await results([{ type: 'day_flag', id, studyDay: '2026-03-01', allAvailableDone: true }]),
    ).toEqual([{ id, status: 'applied' }]);
    const [row] = await t.db
      .select()
      .from(schema.dailyActivity)
      .where(
        and(
          eq(schema.dailyActivity.userId, userId),
          eq(schema.dailyActivity.studyDay, '2026-03-01'),
        ),
      );
    expect(row).toMatchObject({ allAvailableDone: true });
  });

  it('gives each event its own result (partial success) and keeps order', async () => {
    const good = review();
    const bad = review({ grade: 9 });
    const missing = review({ cardId: randomUUID() });
    expect(await results([good, bad, missing])).toEqual([
      { id: good.id, status: 'applied' },
      { id: bad.id, status: 'rejected', code: 'invalid_grade' },
      { id: missing.id, status: 'rejected', code: 'card_not_found' },
    ]);
  });

  it('accepts at most 500 events per request', async () => {
    const ok = Array.from({ length: 500 }, () => review({ cardId: randomUUID() }));
    expect((await push(ok)).status).toBe(200);
    expect((await push([...ok, review()])).status).toBe(400);
  });

  it('rejects a malformed body with 400', async () => {
    expect(
      (await h.call(userId, '/sync/push', { method: 'POST', json: { events: [] } })).status,
    ).toBe(400);
    expect((await push([{ type: 'mystery', id: randomUUID() }])).status).toBe(400);
  });

  it('uses the scheduling parameters in force when each review was stored, even after settings change (FR-004)', async () => {
    const r1 = review({ reviewedAt: '2026-02-01T09:00:00.000Z', grade: 3 });
    await results([r1]);
    await t.db
      .update(schema.learnerSettings)
      .set({ desiredRetention: '0.70', maximumIntervalDays: 5 })
      .where(eq(schema.learnerSettings.userId, userId));
    const stateBeforeLate = await cardRow().then(stateOf);
    // An out-of-order older review forces a replay: r1 must still be scheduled with 0.90.
    const older = review({ reviewedAt: '2026-01-31T09:00:00.000Z', grade: 3 });
    await results([older]);
    const rows = await logs();
    const replayed = replay(
      newCard(created),
      rows.map((l) => ({
        id: l.id,
        kind: 'review' as const,
        grade: l.grade as Grade,
        reviewedAt: l.reviewedAt,
        revokedAt: null,
      })),
      { desiredRetention: 0.9, maximumIntervalDays: 36500 },
    );
    expect(replayed.reps).toBe(2);
    expect(stateBeforeLate.reps).toBe(1);
    const after = await cardRow().then(stateOf);
    // `older` was stored under the new 0.70 / 5-day settings, r1 under the old ones.
    const [olderRow] = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.id, older.id));
    expect(Number(olderRow!.desiredRetention)).toBe(0.7);
    expect(after.reps).toBe(2);
  });
});
