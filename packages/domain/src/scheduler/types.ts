export type Grade = 1 | 2 | 3 | 4;
export type CardState = 'new' | 'learning' | 'review' | 'relearning';

/** The FSRS columns of a card. The review history is the source of truth; this is its result. */
export interface FsrsState {
  state: CardState;
  due: Date;
  stability: number;
  difficulty: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: Date | null;
}

export interface SchedulerParams {
  /** 0.70 - 0.97 (FR-004) */
  desiredRetention: number;
  /** 1 - 36500 (FR-004) */
  maximumIntervalDays: number;
}

export interface ReviewSnapshot {
  grade: Grade;
  reviewedAt: Date;
  stateBefore: FsrsState;
  stateAfter: FsrsState;
  schedulerVersion: string;
}

/** The subset of a stored review log that replay needs. */
export interface ReplayLog {
  id: string;
  kind: 'review' | 'reset';
  grade: Grade | null;
  reviewedAt: Date;
  revokedAt: Date | null;
  /** The parameters this review was made with; falls back to the replay default. */
  params?: SchedulerParams;
}
