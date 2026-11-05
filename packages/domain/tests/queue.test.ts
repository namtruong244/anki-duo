import { describe, expect, it } from 'vitest';
import { loadFixture } from '@anki-duo/fixtures';
import { buildQueue, requeueAfterGrade, type QueueCard } from '../src/queue/build-queue.js';

interface CardJson extends Omit<QueueCard, 'due'> {
  due: string;
}
interface QueueInput {
  now: string;
  studyDayEnd: string;
  sessionSize: number;
  newCardsPerDay: number;
  introducedToday: number;
  cards: CardJson[];
  nodeIndex?: number;
}
interface RequeueInput {
  remaining: string[];
  cardId: string;
  stateAfter: QueueCard['state'];
  nextDue: string;
  now: string;
  studyDayEnd: string;
}
interface Case {
  name: string;
  kind: 'review' | 'ahead' | 'node' | 'requeue';
  input: QueueInput & RequeueInput;
  expected: string[];
}
const { cases } = loadFixture<{ cases: Case[] }>('queue');

describe('buildQueue / requeueAfterGrade (fixtures/queue.json)', () => {
  for (const c of cases.filter((x) => x.kind === 'review' || x.kind === 'ahead')) {
    it(`${c.kind}: ${c.name}`, () => {
      const i = c.input;
      const ids = buildQueue({
        kind: c.kind as 'review' | 'ahead',
        cards: i.cards.map((x) => ({ ...x, due: new Date(x.due) })),
        now: new Date(i.now),
        settings: { sessionSize: i.sessionSize, newCardsPerDay: i.newCardsPerDay },
        studyDayEnd: new Date(i.studyDayEnd),
        introducedToday: i.introducedToday,
      });
      expect(ids).toEqual(c.expected);
    });
  }

  for (const c of cases.filter((x) => x.kind === 'requeue')) {
    it(`requeue: ${c.name}`, () => {
      const i = c.input;
      expect(
        requeueAfterGrade({
          remaining: i.remaining,
          cardId: i.cardId,
          stateAfter: i.stateAfter,
          nextDue: new Date(i.nextDue),
          studyDayEnd: new Date(i.studyDayEnd),
        }),
      ).toEqual(c.expected);
    });
  }

  it('does not mutate its inputs', () => {
    const remaining = ['a', 'b'];
    requeueAfterGrade({
      remaining,
      cardId: 'x',
      stateAfter: 'learning',
      nextDue: new Date('2026-03-01T12:01:00Z'),
      studyDayEnd: new Date('2026-03-01T21:00:00Z'),
    });
    expect(remaining).toEqual(['a', 'b']);
  });
});
