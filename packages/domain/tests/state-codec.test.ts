import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, newCard, schedule } from '../src/scheduler/index.js';

const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };

describe('state codec', () => {
  it('round-trips every state', () => {
    let card = newCard(new Date('2026-01-01T00:00:00.123Z'));
    const seen = new Set<string>();
    for (const g of [3, 3, 3, 3, 1, 3, 4] as const) {
      seen.add(card.state);
      expect(decodeState(encodeState(card))).toEqual(card);
      card = schedule(
        card,
        g,
        new Date(Math.max(card.due.getTime(), Date.parse('2026-01-01T00:00:00.123Z'))),
        params,
      ).card;
    }
    expect(seen).toContain('new');
    expect(seen).toContain('learning');
    expect(seen).toContain('review');
  });

  it('uses the documented layout [stateCode, dueEpochSec, stability, difficulty, steps, reps, lapses, lastReviewEpochSec]', () => {
    const card = {
      state: 'review' as const,
      due: new Date('2026-01-02T00:00:00Z'),
      stability: 4.5,
      difficulty: 5.25,
      learningSteps: 0,
      reps: 3,
      lapses: 1,
      lastReview: new Date('2026-01-01T00:00:00Z'),
    };
    expect(encodeState(card)).toEqual([2, 1767312000, 4.5, 5.25, 0, 3, 1, 1767225600]);
  });

  it('encodes a null lastReview as NaN and decodes it back to null', () => {
    const card = newCard(new Date('2026-01-01T00:00:00Z'));
    const arr = encodeState(card);
    expect(arr[0]).toBe(0);
    expect(Number.isNaN(arr[7])).toBe(true);
    expect(decodeState(arr).lastReview).toBeNull();
  });

  it('keeps millisecond precision', () => {
    const card = { ...newCard(new Date('2026-01-01T00:00:00.001Z')) };
    expect(decodeState(encodeState(card)).due.getTime()).toBe(card.due.getTime());
  });
});
