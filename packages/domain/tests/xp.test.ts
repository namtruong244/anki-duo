import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { reviewXp, sessionBonusXp } from '../src/gamification/xp.js';

interface Fixture {
  review: {
    name: string;
    log: {
      kind: 'review' | 'reset';
      grade: number | null;
      studyAhead: boolean;
      revokedAt: string | null;
    };
    xp: number;
  }[];
  sessionBonus: {
    name: string;
    session: { completed: boolean; kind: 'node' | 'review' | 'ahead' };
    xp: number;
  }[];
}
const fx = loadFixture<Fixture>('xp');

describe('xp (fixtures/xp.json)', () => {
  for (const c of fx.review) it(`reviewXp: ${c.name}`, () => expect(reviewXp(c.log)).toBe(c.xp));
  for (const c of fx.sessionBonus)
    it(`sessionBonusXp: ${c.name}`, () => expect(sessionBonusXp(c.session)).toBe(c.xp));
});
