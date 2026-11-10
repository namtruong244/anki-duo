import { describe, expect, it } from 'vitest';
import { buildChoices } from '../src/index.js';

/** mulberry32: a small seeded PRNG for the tests. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('buildChoices', () => {
  it('contains the correct answer and the wrong ones', () => {
    const r = buildChoices({ correct: 'Paris', wrong: ['Rome', 'Oslo'], pool: [], rng: seeded(1) })!;
    expect([...r].sort()).toEqual(['Oslo', 'Paris', 'Rome']);
  });
  it('de-duplicates after normalization and drops wrong answers equal to the correct one', () => {
    const r = buildChoices({
      correct: 'Paris',
      wrong: ['rome', ' Rome ', 'ROME', 'paris', 'Oslo'],
      pool: [],
      rng: seeded(2),
    })!;
    expect([...r].map((s) => s.toLowerCase()).sort()).toEqual(['oslo', 'paris', 'rome']);
  });
  it('samples at most 7 wrong answers, always keeping the correct one', () => {
    const wrong = Array.from({ length: 10 }, (_, i) => `w${i}`);
    const subsets = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const r = buildChoices({ correct: 'right', wrong, pool: [], rng: seeded(seed) })!;
      expect(r).toHaveLength(8);
      expect(r).toContain('right');
      expect(new Set(r).size).toBe(8);
      subsets.add(r.filter((x) => x !== 'right').sort().join());
    }
    expect(subsets.size).toBeGreaterThan(1);
  });
  it('falls back to up to 3 distractors from the pool when there are no wrong answers', () => {
    const pool = ['', 'a very long answer '.repeat(10), 'Paris', 'x', 'X', 'y', 'z', 'w'];
    const r = buildChoices({ correct: 'Paris', wrong: [], pool, rng: seeded(3) })!;
    expect(r).toHaveLength(4);
    expect(r).toContain('Paris');
    expect(r.filter((x) => x === 'Paris')).toHaveLength(1);
    const others = r.filter((x) => x !== 'Paris').map((s) => s.toLowerCase());
    expect(new Set(others).size).toBe(3);
    for (const o of others) expect(['x', 'y', 'z', 'w']).toContain(o);
  });
  it('does not use the pool when wrong answers exist', () => {
    const r = buildChoices({ correct: 'a', wrong: ['b'], pool: ['c', 'd', 'e'], rng: seeded(4) })!;
    expect([...r].sort()).toEqual(['a', 'b']);
  });
  it('returns null with fewer than 2 distinct options', () => {
    expect(buildChoices({ correct: 'a', wrong: [], pool: [], rng: seeded(1) })).toBeNull();
    expect(buildChoices({ correct: 'a', wrong: ['A', ' a'], pool: ['a'], rng: seeded(1) })).toBeNull();
  });
  it('returns null when the correct answer is empty or longer than 80 characters', () => {
    expect(buildChoices({ correct: '  ', wrong: ['b'], pool: [], rng: seeded(1) })).toBeNull();
    expect(
      buildChoices({ correct: 'x'.repeat(81), wrong: ['b'], pool: [], rng: seeded(1) }),
    ).toBeNull();
    expect(
      buildChoices({ correct: 'x'.repeat(80), wrong: ['b'], pool: [], rng: seeded(1) }),
    ).not.toBeNull();
  });
  it('the same seed gives the same order and different seeds give different orders', () => {
    const args = { correct: 'c', wrong: ['a', 'b', 'd', 'e', 'f'], pool: [] };
    const one = buildChoices({ ...args, rng: seeded(7) });
    expect(buildChoices({ ...args, rng: seeded(7) })).toEqual(one);
    const orders = new Set<string>();
    for (let s = 1; s <= 10; s++) orders.add(buildChoices({ ...args, rng: seeded(s) })!.join('|'));
    expect(orders.size).toBeGreaterThan(1);
  });
  it('never calls rng outside [0,1) assumptions (rng returning 0.999.. stays in range)', () => {
    const r = buildChoices({ correct: 'a', wrong: ['b', 'c'], pool: [], rng: () => 0.9999999 })!;
    expect([...r].sort()).toEqual(['a', 'b', 'c']);
  });
});
