import { describe, expect, it } from 'vitest';
import { newCard, replay, schedule, type Grade, type ReplayLog } from '../src/scheduler/index.js';

const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
const t0 = new Date('2026-01-01T00:00:00Z');
const created = newCard(t0);

const review = (id: string, at: string, grade: Grade, revoked = false): ReplayLog => ({
  id,
  kind: 'review',
  grade,
  reviewedAt: new Date(at),
  revokedAt: revoked ? new Date(at) : null,
});

const logs: ReplayLog[] = [
  review('a', '2026-01-01T00:00:00Z', 3),
  review('b', '2026-01-01T00:10:00Z', 3),
  review('c', '2026-01-02T00:00:00Z', 4),
  review('d', '2026-01-20T00:00:00Z', 1),
];

describe('replay', () => {
  it('equals applying schedule step by step', () => {
    let card = created;
    for (const l of logs) card = schedule(card, l.grade as Grade, l.reviewedAt, params).card;
    expect(replay(created, logs, params)).toEqual(card);
  });

  it('gives the same result for out-of-order input', () => {
    const shuffled = [logs[2]!, logs[0]!, logs[3]!, logs[1]!];
    expect(replay(created, shuffled, params)).toEqual(replay(created, logs, params));
  });

  it('breaks ties on reviewed_at by id', () => {
    const x = review('x', '2026-01-01T00:00:00Z', 1);
    const y = review('y', '2026-01-01T00:00:00Z', 4);
    expect(replay(created, [y, x], params)).toEqual(replay(created, [x, y], params));
  });

  it('skips revoked logs', () => {
    const withRevoked = [...logs, review('e', '2026-02-01T00:00:00Z', 1, true)];
    expect(replay(created, withRevoked, params)).toEqual(replay(created, logs, params));
  });

  it('a reset returns the card to new, then reviews continue', () => {
    const reset: ReplayLog = {
      id: 'r',
      kind: 'reset',
      grade: null,
      reviewedAt: new Date('2026-01-21T00:00:00Z'),
      revokedAt: null,
    };
    const after = review('f', '2026-01-22T00:00:00Z', 3);
    const resetOnly = replay(created, [...logs, reset], params);
    expect(resetOnly).toEqual(newCard(reset.reviewedAt));
    expect(replay(created, [...logs, reset, after], params)).toEqual(
      schedule(newCard(reset.reviewedAt), 3, after.reviewedAt, params).card,
    );
  });

  it("uses each log's own parameters when it has them (FR-004)", () => {
    const strict = { desiredRetention: 0.7, maximumIntervalDays: 3 };
    const mixed = [
      { ...review('a', '2026-01-01T00:00:00Z', 4), params: params },
      { ...review('b', '2026-01-10T00:00:00Z', 3), params: strict },
    ];
    const expected = schedule(
      schedule(created, 4, mixed[0]!.reviewedAt, params).card,
      3,
      mixed[1]!.reviewedAt,
      strict,
    ).card;
    expect(replay(created, mixed, params)).toEqual(expected);
    expect(replay(created, mixed, params)).not.toEqual(
      replay(
        created,
        [review('a', '2026-01-01T00:00:00Z', 4), review('b', '2026-01-10T00:00:00Z', 3)],
        params,
      ),
    );
  });

  it('returns the initial card with no logs', () => {
    expect(replay(created, [], params)).toEqual(created);
  });

  it('does not mutate its input', () => {
    const copy = [...logs];
    replay(created, copy, params);
    expect(copy).toEqual(logs);
  });
});
