import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { assignNodeIndex, NODE_SIZE } from '../src/path/assign.js';

interface Fixture {
  cases: { name: string; lastNodeIndex: number | null; lastNodeCount: number; expected: number }[];
  sequences: {
    name: string;
    count?: number;
    existing?: { nodeIndex: number }[];
    deleted?: { nodeIndex: number }[];
    add?: number;
    expectedNodeIndexes: number[];
  }[];
}
const fx = loadFixture<Fixture>('path-assign');

/** Mirrors how the API calls it: look at the deck's last node among live cards. */
function addCards(live: number[], n: number): number[] {
  const added: number[] = [];
  for (let i = 0; i < n; i++) {
    const last = live.length ? Math.max(...live) : null;
    const count = last === null ? 0 : live.filter((x) => x === last).length;
    const idx = assignNodeIndex(last, count);
    live.push(idx);
    added.push(idx);
  }
  return added;
}

describe('assignNodeIndex (fixtures/path-assign.json)', () => {
  it('a node holds 10 cards', () => expect(NODE_SIZE).toBe(10));

  for (const c of fx.cases) {
    it(c.name, () => expect(assignNodeIndex(c.lastNodeIndex, c.lastNodeCount)).toBe(c.expected));
  }

  for (const s of fx.sequences) {
    it(s.name, () => {
      if (s.count !== undefined) {
        expect(addCards([], s.count)).toEqual(s.expectedNodeIndexes);
      } else {
        const live = (s.existing ?? []).map((c) => c.nodeIndex);
        for (const d of s.deleted ?? []) live.splice(live.indexOf(d.nodeIndex), 1);
        expect(addCards(live, s.add ?? 0)).toEqual(s.expectedNodeIndexes);
      }
    });
  }
});
