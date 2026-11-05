import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { pathNodes, type PathCard } from '../src/path/status.js';

interface Case {
  name: string;
  cards: PathCard[];
  expected: {
    index: number;
    status: string;
    cardCount: number;
    studiedCount: number;
    mastery: number;
  }[];
}
const { cases } = loadFixture<{ cases: Case[] }>('path-status');

describe('pathNodes (fixtures/path-status.json)', () => {
  for (const c of cases) {
    it(c.name, () => {
      const nodes = pathNodes(c.cards);
      expect(
        nodes.map((n) => ({
          index: n.index,
          status: n.status,
          cardCount: n.cardCount,
          studiedCount: n.studiedCount,
        })),
      ).toEqual(
        c.expected.map((e) => ({
          index: e.index,
          status: e.status,
          cardCount: e.cardCount,
          studiedCount: e.studiedCount,
        })),
      );
      nodes.forEach((n, i) => expect(n.mastery).toBeCloseTo(c.expected[i]!.mastery, 10));
    });
  }

  it('lists card ids per node in input order', () => {
    const nodes = pathNodes([
      { id: 'a', nodeIndex: 1, state: 'new', suspended: false, position: 2 },
      { id: 'b', nodeIndex: 1, state: 'new', suspended: false, position: 1 },
    ] as PathCard[]);
    expect(nodes[0]!.cardIds).toEqual(['b', 'a']);
  });
});
