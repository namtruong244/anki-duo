import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  type Card as FsrsCard,
  type Grade as FsrsGrade,
} from 'ts-fsrs';
import { TS_FSRS_VERSION } from './version.js';
import type { CardState, FsrsState, Grade, ReviewSnapshot, SchedulerParams } from './types.js';

export type {
  CardState,
  FsrsState,
  Grade,
  ReplayLog,
  ReviewSnapshot,
  SchedulerParams,
} from './types.js';
export { decodeState, encodeState } from './state-codec.js';
export { replay } from './replay.js';
export { TS_FSRS_VERSION };

/** Stamped on every review log so a later algorithm change can be told apart (research R2). */
export const SCHEDULER_VERSION = `ts-fsrs@${TS_FSRS_VERSION}/fsrs-6`;

const DAY_MS = 86_400_000;
const STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning'];
const STATE_CODE: Record<CardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

export function validateParams(params: SchedulerParams): void {
  const { desiredRetention: r, maximumIntervalDays: m } = params;
  if (!Number.isFinite(r) || r < 0.7 || r > 0.97) {
    throw new RangeError(`desiredRetention must be within 0.70-0.97, got ${r}`);
  }
  if (!Number.isInteger(m) || m < 1 || m > 36500) {
    throw new RangeError(`maximumIntervalDays must be an integer within 1-36500, got ${m}`);
  }
}

/** A brand-new card, due at creation time. */
export function newCard(now: Date): FsrsState {
  return fromFsrs(createEmptyCard(now));
}

/** A reset returns the card to `new`; history is kept in the log (FR-012). */
export function resetCard(_card: FsrsState, now: Date): FsrsState {
  return newCard(now);
}

export function schedule(
  card: FsrsState,
  grade: Grade,
  now: Date,
  params: SchedulerParams,
): { card: FsrsState; log: ReviewSnapshot } {
  const next = fromFsrs(engine(params).next(toFsrs(card), now, grade as FsrsGrade).card);
  return {
    card: next,
    log: {
      grade,
      reviewedAt: now,
      stateBefore: card,
      stateAfter: next,
      schedulerVersion: SCHEDULER_VERSION,
    },
  };
}

/** The interval until the next review for each grade, in milliseconds (FR-002). */
export function previewIntervals(
  card: FsrsState,
  now: Date,
  params: SchedulerParams,
): { again: number; hard: number; good: number; easy: number } {
  const rec = engine(params).repeat(toFsrs(card), now);
  const ms = (g: FsrsGrade) => rec[g as 1 | 2 | 3 | 4].card.due.getTime() - now.getTime();
  return { again: ms(1), hard: ms(2), good: ms(3), easy: ms(4) };
}

function engine(params: SchedulerParams) {
  validateParams(params);
  return fsrs(
    generatorParameters({
      request_retention: params.desiredRetention,
      maximum_interval: params.maximumIntervalDays,
      // Fuzz is off so replays are exact (research R2).
      enable_fuzz: false,
    }),
  );
}

function toFsrs(c: FsrsState): FsrsCard {
  const card: FsrsCard = {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    scheduled_days: c.lastReview
      ? Math.max(0, Math.round((c.due.getTime() - c.lastReview.getTime()) / DAY_MS))
      : 0,
    learning_steps: c.learningSteps,
    reps: c.reps,
    lapses: c.lapses,
    state: STATE_CODE[c.state],
  };
  if (c.lastReview) card.last_review = c.lastReview;
  return card;
}

function fromFsrs(c: FsrsCard): FsrsState {
  return {
    state: STATES[c.state] as CardState,
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    lastReview: c.last_review ?? null,
  };
}
