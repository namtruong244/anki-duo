import type { CardState, FsrsState } from './types.js';

/** `[stateCode, dueEpochSec, stability, difficulty, learningSteps, reps, lapses, lastReviewEpochSec]` */
export type EncodedState = [number, number, number, number, number, number, number, number];

const STATES: readonly CardState[] = ['new', 'learning', 'review', 'relearning'];

const toSec = (d: Date) => d.getTime() / 1000;
const fromSec = (s: number) => new Date(Math.round(s * 1000));

export function encodeState(s: FsrsState): EncodedState {
  return [
    STATES.indexOf(s.state),
    toSec(s.due),
    s.stability,
    s.difficulty,
    s.learningSteps,
    s.reps,
    s.lapses,
    s.lastReview ? toSec(s.lastReview) : NaN,
  ];
}

export function decodeState(a: readonly number[]): FsrsState {
  const [code, due, stability, difficulty, steps, reps, lapses, last] = a as EncodedState;
  const state = STATES[code];
  if (state === undefined) throw new RangeError(`unknown state code ${code}`);
  return {
    state,
    due: fromSec(due),
    stability,
    difficulty,
    learningSteps: steps,
    reps,
    lapses,
    lastReview: Number.isNaN(last) ? null : fromSec(last),
  };
}
