import type { FsrsState } from '../../src/scheduler/types.js';

export interface FsrsStateJson {
  state: FsrsState['state'];
  due: string;
  stability: number;
  difficulty: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}

export const fromJson = (s: FsrsStateJson): FsrsState => ({
  ...s,
  due: new Date(s.due),
  lastReview: s.lastReview ? new Date(s.lastReview) : null,
});

export const toJson = (s: FsrsState): FsrsStateJson => ({
  ...s,
  due: s.due.toISOString(),
  lastReview: s.lastReview ? s.lastReview.toISOString() : null,
});
