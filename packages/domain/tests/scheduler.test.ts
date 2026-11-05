import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import {
  SCHEDULER_VERSION,
  newCard,
  previewIntervals,
  resetCard,
  schedule,
  validateParams,
  type Grade,
} from '../src/scheduler/index.js';
import { fromJson, toJson, type FsrsStateJson } from './helpers/state.js';

interface Vectors {
  version: string;
  cases: {
    name: string;
    desiredRetention: number;
    maximumIntervalDays: number;
    initial: FsrsStateJson;
    steps: { at: string; grade: Grade; expected: FsrsStateJson }[];
  }[];
}
const vectors = loadFixture<Vectors>('fsrs-vectors');

describe('scheduler matches the FSRS reference vectors (SC-004)', () => {
  for (const c of vectors.cases) {
    it(c.name, () => {
      const params = {
        desiredRetention: c.desiredRetention,
        maximumIntervalDays: c.maximumIntervalDays,
      };
      let card = fromJson(c.initial);
      for (const step of c.steps) {
        card = schedule(card, step.grade, new Date(step.at), params).card;
        expect(toJson(card)).toEqual(step.expected);
      }
    });
  }

  it('is deterministic', () => {
    const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
    const now = new Date('2026-01-01T00:00:00Z');
    const a = schedule(newCard(now), 3, now, params);
    const b = schedule(newCard(now), 3, now, params);
    expect(a).toEqual(b);
  });

  it('the version stamp pins the installed library exactly', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const installed = JSON.parse(
      readFileSync(new URL('../node_modules/ts-fsrs/package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.dependencies['ts-fsrs']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed.version).toBe(pkg.dependencies['ts-fsrs']);
    expect(SCHEDULER_VERSION).toBe(`ts-fsrs@${installed.version}/fsrs-6`);
    expect(vectors.version).toBe(installed.version);
  });

  it('returns a review log snapshot', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const r = schedule(newCard(now), 3, now, { desiredRetention: 0.9, maximumIntervalDays: 36500 });
    expect(r.log).toMatchObject({ grade: 3, reviewedAt: now, schedulerVersion: SCHEDULER_VERSION });
    expect(r.log.stateBefore.state).toBe('new');
    expect(r.log.stateAfter).toEqual(r.card);
  });
});

describe('previewIntervals', () => {
  const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
  const now = new Date('2026-01-01T00:00:00Z');

  it('returns 4 intervals ordered Again <= Hard <= Good <= Easy', () => {
    let card = newCard(now);
    const states = [card];
    for (const g of [3, 3, 3, 3] as Grade[]) {
      const t = new Date(card.due.getTime());
      card = schedule(card, g, t, params).card;
      states.push(card);
    }
    for (const s of states) {
      const p = previewIntervals(s, s.due > now ? s.due : now, params);
      expect(p.again).toBeLessThanOrEqual(p.hard);
      expect(p.hard).toBeLessThanOrEqual(p.good);
      expect(p.good).toBeLessThanOrEqual(p.easy);
    }
  });
});

describe('resetCard', () => {
  it('returns the card to new', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
    const reviewed = schedule(newCard(now), 4, now, params).card;
    const later = new Date('2026-02-01T00:00:00Z');
    expect(resetCard(reviewed, later)).toEqual(newCard(later));
  });
});

describe('validateParams', () => {
  it('rejects desired_retention outside 0.70-0.97', () => {
    expect(() => validateParams({ desiredRetention: 0.69, maximumIntervalDays: 100 })).toThrow();
    expect(() => validateParams({ desiredRetention: 0.98, maximumIntervalDays: 100 })).toThrow();
    expect(() => validateParams({ desiredRetention: 0.7, maximumIntervalDays: 100 })).not.toThrow();
    expect(() =>
      validateParams({ desiredRetention: 0.97, maximumIntervalDays: 100 }),
    ).not.toThrow();
  });

  it('rejects maximum_interval_days outside 1-36500', () => {
    expect(() => validateParams({ desiredRetention: 0.9, maximumIntervalDays: 0 })).toThrow();
    expect(() => validateParams({ desiredRetention: 0.9, maximumIntervalDays: 36501 })).toThrow();
    expect(() => validateParams({ desiredRetention: 0.9, maximumIntervalDays: 1.5 })).toThrow();
    expect(() =>
      validateParams({ desiredRetention: 0.9, maximumIntervalDays: 36500 }),
    ).not.toThrow();
  });
});
