import { and, asc, eq, isNull } from 'drizzle-orm';
import type { PushEvent } from '@anki-duo/contract';
import {
  SCHEDULER_VERSION,
  encodeState,
  endOfStudyDay,
  newCard,
  replay,
  reviewXp,
  schedule,
  sessionBonusXp,
  studyDay,
  type Grade,
  type ReplayLog,
  type SchedulerParams,
} from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import { recomputeActivity } from '../services/activity.js';

export type PushResult = {
  id: string;
  status: 'applied' | 'duplicate' | 'rejected';
  code?: 'card_not_found' | 'future_timestamp' | 'invalid_grade' | 'review_not_found';
};

const FUTURE_TOLERANCE_MS = 5 * 60_000;
const applied = (id: string): PushResult => ({ id, status: 'applied' });
const duplicate = (id: string): PushResult => ({ id, status: 'duplicate' });
const rejected = (id: string, code: NonNullable<PushResult['code']>): PushResult => ({
  id,
  status: 'rejected',
  code,
});

interface Ctx {
  userId: string;
  now: Date;
  timeZone: string;
  dayStartHour: number;
  params: SchedulerParams;
  /** Study days whose daily activity must be recomputed after the event. */
  touched: Set<string>;
}

/**
 * Applies outbox events in order. Each event is its own transaction and gets its own result, so a
 * bad event never blocks the rest. Pushing the same event again is harmless (idempotent).
 */
export async function pushEvents(
  db: Db,
  userId: string,
  events: readonly PushEvent[],
  now: Date,
): Promise<PushResult[]> {
  const [s] = await db
    .select()
    .from(schema.learnerSettings)
    .where(eq(schema.learnerSettings.userId, userId));
  const ctx: Ctx = {
    userId,
    now,
    timeZone: s?.timeZone ?? 'UTC',
    dayStartHour: s?.dayStartHour ?? 4,
    params: {
      desiredRetention: Number(s?.desiredRetention ?? '0.90'),
      maximumIntervalDays: s?.maximumIntervalDays ?? 36500,
    },
    touched: new Set(),
  };
  const results: PushResult[] = [];
  for (const event of events) {
    results.push(
      await db.transaction(async (t) => {
        const tx = t as unknown as Db;
        ctx.touched.clear();
        const result = await applyEvent(tx, ctx, event);
        if (result.status === 'applied') await recomputeActivity(tx, userId, ctx.touched, now);
        return result;
      }),
    );
  }
  return results;
}

function applyEvent(tx: Db, ctx: Ctx, event: PushEvent): Promise<PushResult> {
  switch (event.type) {
    case 'review':
      return applyReview(tx, ctx, event);
    case 'revoke':
      return applyRevoke(tx, ctx, event);
    case 'session':
      return applySession(tx, ctx, event);
    case 'day_flag':
      return applyDayFlag(tx, ctx, event);
  }
}

type LogRow = typeof schema.reviewLog.$inferSelect;
const toReplayLog = (l: LogRow): ReplayLog => ({
  id: l.id,
  kind: l.kind as 'review' | 'reset',
  grade: l.grade as Grade | null,
  reviewedAt: l.reviewedAt,
  revokedAt: l.revokedAt,
  params: {
    desiredRetention: Number(l.desiredRetention),
    maximumIntervalDays: l.maximumIntervalDays,
  },
});

const lockCard = async (tx: Db, userId: string, cardId: string) =>
  (
    await tx
      .select()
      .from(schema.card)
      .where(
        and(
          eq(schema.card.id, cardId),
          eq(schema.card.userId, userId),
          isNull(schema.card.deletedAt),
        ),
      )
      .for('update')
  )[0];

const cardLogs = (tx: Db, cardId: string) =>
  tx
    .select()
    .from(schema.reviewLog)
    .where(eq(schema.reviewLog.cardId, cardId))
    .orderBy(asc(schema.reviewLog.reviewedAt), asc(schema.reviewLog.id));

/** The card's FSRS columns are a cache of its history; this rebuilds them. */
async function rebuildCard(
  tx: Db,
  card: typeof schema.card.$inferSelect,
  logs: LogRow[],
  params: SchedulerParams,
) {
  const state = replay(newCard(card.createdAt), logs.map(toReplayLog), params);
  await tx
    .update(schema.card)
    .set({
      state: state.state,
      due: state.due,
      stability: state.stability,
      difficulty: state.difficulty,
      learningSteps: state.learningSteps,
      reps: state.reps,
      lapses: state.lapses,
      lastReview: state.lastReview,
    })
    .where(eq(schema.card.id, card.id));
}

async function applyReview(
  tx: Db,
  ctx: Ctx,
  e: Extract<PushEvent, { type: 'review' }>,
): Promise<PushResult> {
  if (!Number.isInteger(e.grade) || e.grade < 1 || e.grade > 4)
    return rejected(e.id, 'invalid_grade');
  const reviewedAt = new Date(e.reviewedAt);
  if (reviewedAt.getTime() > ctx.now.getTime() + FUTURE_TOLERANCE_MS)
    return rejected(e.id, 'future_timestamp');

  const card = await lockCard(tx, ctx.userId, e.cardId);
  if (!card) return rejected(e.id, 'card_not_found');

  const existing = await tx
    .select({ id: schema.reviewLog.id })
    .from(schema.reviewLog)
    .where(eq(schema.reviewLog.id, e.id));
  if (existing.length) return duplicate(e.id);

  // The server's own schedule is the truth: the state before this review is the replay of every
  // review that sorts before it, and the client's stateAfter is ignored.
  const logs = await cardLogs(tx, card.id);
  const before = logs.filter(
    (l) =>
      l.reviewedAt.getTime() < reviewedAt.getTime() ||
      (l.reviewedAt.getTime() === reviewedAt.getTime() && l.id < e.id),
  );
  const stateBefore = replay(newCard(card.createdAt), before.map(toReplayLog), ctx.params);
  const { card: stateAfter } = schedule(stateBefore, e.grade as Grade, reviewedAt, ctx.params);

  const learning = stateBefore.state === 'learning' || stateBefore.state === 'relearning';
  const studyAhead =
    stateBefore.state === 'review' &&
    stateBefore.due.getTime() >
      endOfStudyDay(
        studyDay(reviewedAt, ctx.timeZone, ctx.dayStartHour),
        ctx.timeZone,
        ctx.dayStartHour,
      ).getTime();

  const inserted = await tx
    .insert(schema.reviewLog)
    .values({
      id: e.id,
      userId: ctx.userId,
      cardId: card.id,
      deckId: card.deckId,
      sessionId: e.sessionId,
      kind: 'review',
      grade: e.grade,
      reviewedAt,
      durationMs: Math.min(3_600_000, Math.max(0, e.durationMs)),
      wasNew: stateBefore.state === 'new',
      wasDue: learning || stateBefore.due.getTime() <= reviewedAt.getTime(),
      studyAhead,
      xp: reviewXp({ kind: 'review', studyAhead, revokedAt: null }),
      stateBefore: encodeState(stateBefore),
      stateAfter: encodeState(stateAfter),
      schedulerVersion: SCHEDULER_VERSION,
      desiredRetention: ctx.params.desiredRetention.toFixed(2),
      maximumIntervalDays: ctx.params.maximumIntervalDays,
    })
    .onConflictDoNothing()
    .returning({ id: schema.reviewLog.id });
  if (!inserted.length) return duplicate(e.id);

  await rebuildCard(tx, card, await cardLogs(tx, card.id), ctx.params);
  ctx.touched.add(studyDay(reviewedAt, ctx.timeZone, ctx.dayStartHour));
  return applied(e.id);
}

async function applyRevoke(
  tx: Db,
  ctx: Ctx,
  e: Extract<PushEvent, { type: 'revoke' }>,
): Promise<PushResult> {
  const [log] = await tx
    .select()
    .from(schema.reviewLog)
    .where(and(eq(schema.reviewLog.id, e.reviewId), eq(schema.reviewLog.userId, ctx.userId)));
  if (!log) return rejected(e.id, 'review_not_found');
  if (log.revokedAt) return duplicate(e.id);

  const card = await lockCard(tx, ctx.userId, log.cardId);
  if (!card) return rejected(e.id, 'review_not_found');
  await tx
    .update(schema.reviewLog)
    .set({ revokedAt: new Date(e.revokedAt), xp: 0 })
    .where(and(eq(schema.reviewLog.id, log.id), isNull(schema.reviewLog.revokedAt)));
  await rebuildCard(tx, card, await cardLogs(tx, card.id), ctx.params);
  ctx.touched.add(studyDay(log.reviewedAt, ctx.timeZone, ctx.dayStartHour));
  return applied(e.id);
}

async function applySession(
  tx: Db,
  ctx: Ctx,
  e: Extract<PushEvent, { type: 'session' }>,
): Promise<PushResult> {
  const [deck] = await tx
    .select({ id: schema.deck.id })
    .from(schema.deck)
    .where(
      and(
        eq(schema.deck.id, e.deckId),
        eq(schema.deck.userId, ctx.userId),
        isNull(schema.deck.deletedAt),
      ),
    );
  if (!deck) return rejected(e.id, 'card_not_found');

  const startedAt = new Date(e.startedAt);
  const values = {
    kind: e.kind,
    nodeIndex: e.nodeIndex ?? null,
    startedAt,
    endedAt: e.endedAt ? new Date(e.endedAt) : null,
    plannedCount: e.plannedCount,
    cardsReviewed: e.cardsReviewed,
    correctCount: e.correctCount,
    completed: e.completed,
    bonusXp: sessionBonusXp({ completed: e.completed, kind: e.kind }),
    studyDay: studyDay(startedAt, ctx.timeZone, ctx.dayStartHour),
  };
  const rows = await tx
    .insert(schema.studySession)
    .values({ id: e.id, userId: ctx.userId, deckId: e.deckId, ...values })
    .onConflictDoUpdate({
      target: schema.studySession.id,
      set: values,
      setWhere: eq(schema.studySession.userId, ctx.userId),
    })
    .returning({ id: schema.studySession.id });
  if (rows.length) ctx.touched.add(values.studyDay);
  return rows.length ? applied(e.id) : duplicate(e.id);
}

async function applyDayFlag(
  tx: Db,
  ctx: Ctx,
  e: Extract<PushEvent, { type: 'day_flag' }>,
): Promise<PushResult> {
  const [s] = await tx
    .select({ goal: schema.learnerSettings.dailyXpGoal })
    .from(schema.learnerSettings)
    .where(eq(schema.learnerSettings.userId, ctx.userId));
  await tx
    .insert(schema.dailyActivity)
    .values({
      userId: ctx.userId,
      studyDay: e.studyDay,
      goalXp: s?.goal ?? 20,
      allAvailableDone: true,
      goalMet: true,
    })
    .onConflictDoUpdate({
      target: [schema.dailyActivity.userId, schema.dailyActivity.studyDay],
      set: { allAvailableDone: true, goalMet: true },
    });
  ctx.touched.add(e.studyDay);
  return applied(e.id);
}
