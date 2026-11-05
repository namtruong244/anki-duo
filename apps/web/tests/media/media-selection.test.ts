import { describe, expect, it } from 'vitest';
import {
  CACHE_LIMIT_BYTES,
  evictionPlan,
  mediaForToday,
  prefetchPlan,
} from '../../src/client/media-cache';
import type { Card, MediaAsset } from '../../src/client/local-store';

const card = (id: string) => ({ id }) as Card;
const media = (id: string, cardId: string, bytes = 1000, deletedAt: string | null = null) =>
  ({
    id,
    cardId,
    bytes,
    deletedAt,
    side: 'front',
    kind: 'image',
    mime: 'image/png',
    sort: 0,
  }) as MediaAsset;

describe('mediaForToday', () => {
  it("returns exactly the media of today's cards", () => {
    const rows = [media('m1', 'c1'), media('m2', 'c1'), media('m3', 'c2'), media('m4', 'c9')];
    expect(mediaForToday([card('c1'), card('c2'), card('c3')], rows).map((m) => m.id)).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('skips deleted media and returns nothing for an empty queue', () => {
    expect(mediaForToday([card('c1')], [media('m1', 'c1', 1, '2026-01-01T00:00:00Z')])).toEqual([]);
    expect(mediaForToday([], [media('m1', 'c1')])).toEqual([]);
  });
});

describe('prefetchPlan', () => {
  it("lists today's media that is not cached yet", () => {
    const today = [media('m1', 'c1'), media('m2', 'c1')];
    expect(prefetchPlan(today, new Set(['m1']))).toEqual(['m2']);
  });
});

describe('evictionPlan', () => {
  const entry = (id: string, mb: number, cachedAt: number) => ({
    id,
    bytes: mb * 1024 * 1024,
    cachedAt,
  });

  it('keeps the cache at or under 200 MB by evicting the oldest media first', () => {
    const cached = [entry('old', 120, 1), entry('mid', 60, 2), entry('new', 60, 3)];
    const plan = evictionPlan({ cached, todayIds: new Set(), limitBytes: CACHE_LIMIT_BYTES });
    expect(plan.evict).toEqual(['old']);
    const kept = cached.filter((c) => !plan.evict.includes(c.id)).reduce((n, c) => n + c.bytes, 0);
    expect(kept).toBeLessThanOrEqual(CACHE_LIMIT_BYTES);
  });

  it("never evicts media for today's queue, even when it is the oldest", () => {
    const cached = [entry('today', 150, 1), entry('a', 40, 2), entry('b', 40, 3)];
    const plan = evictionPlan({
      cached,
      todayIds: new Set(['today']),
      limitBytes: CACHE_LIMIT_BYTES,
    });
    expect(plan.evict).toEqual(['a']);
    expect(plan.evict).not.toContain('today');
  });

  it('evicts nothing when under the limit', () => {
    expect(
      evictionPlan({
        cached: [entry('a', 10, 1)],
        todayIds: new Set(),
        limitBytes: CACHE_LIMIT_BYTES,
      }).evict,
    ).toEqual([]);
  });

  it("reports when today's media alone exceed the limit, without evicting it", () => {
    const cached = [entry('t1', 150, 1), entry('t2', 100, 2), entry('x', 5, 3)];
    const plan = evictionPlan({
      cached,
      todayIds: new Set(['t1', 't2']),
      limitBytes: CACHE_LIMIT_BYTES,
    });
    expect(plan.evict).toEqual(['x']);
    expect(plan.overBudget).toBe(true);
  });

  it('the limit is 200 MB', () => expect(CACHE_LIMIT_BYTES).toBe(200 * 1024 * 1024));
});
