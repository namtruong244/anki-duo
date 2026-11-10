import { beforeEach, describe, expect, it } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';
import type { Card, Deck, OutboxEvent, StoredSession } from '../src/client/local-store';

const card = (
  id: string,
  over: Partial<Card> & { state?: Card['fsrs']['state']; due?: string } = {},
): Card => ({
  id,
  deckId: over.deckId ?? 'd1',
  position: 0,
  nodeIndex: over.nodeIndex ?? 0,
  front: 'f',
  back: 'b',
  tags: [],
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  format: 'markdown' as const,
  fsrs: {
    state: over.state ?? 'new',
    due: over.due ?? '2026-01-01T00:00:00.000Z',
    stability: 0,
    difficulty: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});
const deck = (id: string): Deck => ({
  id,
  name: id,
  newCardsPerDay: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});
const review = (id: string, cardId: string): OutboxEvent => ({
  type: 'review',
  id,
  cardId,
  sessionId: 's1',
  grade: 3,
  reviewedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1000,
  studyAhead: false,
  schedulerVersion: 'v',
  stateBefore: card(cardId).fsrs,
  stateAfter: card(cardId).fsrs,
});

let store: DexieStore;
beforeEach(async () => {
  store = new DexieStore(`test-${Math.random()}`);
  await store.clearAll();
});

describe('DexieStore', () => {
  it('meta CRUD', async () => {
    expect(await store.getMeta('pullCursor')).toBeUndefined();
    await store.setMeta('pullCursor', '12');
    expect(await store.getMeta('pullCursor')).toBe('12');
  });

  it('settings and stats CRUD', async () => {
    const settings = {
      locale: 'vi',
      timeZone: 'UTC',
      dayStartHour: 4,
      desiredRetention: 0.9,
      maximumIntervalDays: 36500,
      dailyXpGoal: 20,
      sessionSize: 20,
      soundEnabled: true,
      motion: 'system',
    } as const;
    await store.putSettings('u', settings);
    expect(await store.getSettings('u')).toEqual(settings);
    const stats = {
      totalXp: 1,
      currentStreak: 0,
      longestStreak: 0,
      lastGoalDay: null,
      cardCount: 0,
      mediaBytes: 0,
    };
    await store.putStats('u', stats);
    expect(await store.getStats('u')).toEqual(stats);
  });

  it('decks CRUD', async () => {
    await store.putDecks([deck('a'), deck('b')]);
    expect((await store.listDecks()).map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect((await store.getDeck('a'))?.name).toBe('a');
  });

  it('cards CRUD and the [deckId+state+due] index', async () => {
    await store.putCards([
      card('c1', { state: 'review', due: '2026-01-02T00:00:00.000Z' }),
      card('c2', { state: 'review', due: '2026-01-05T00:00:00.000Z' }),
      card('c3', { state: 'learning', due: '2026-01-01T00:00:00.000Z' }),
      card('c4', { state: 'review', due: '2026-01-01T00:00:00.000Z', deckId: 'd2' }),
    ]);
    expect(await store.getCard('c1')).toBeDefined();
    const due = await store.listCardsByState('d1', 'review', '2026-01-03T00:00:00.000Z');
    expect(due.map((c) => c.id)).toEqual(['c1']);
    expect((await store.listCardsByState('d1', 'review')).map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('the [deckId+nodeIndex] index', async () => {
    await store.putCards([
      card('c1', { nodeIndex: 0 }),
      card('c2', { nodeIndex: 1 }),
      card('c3', { nodeIndex: 1 }),
    ]);
    expect((await store.listCardsByNode('d1', 1)).map((c) => c.id).sort()).toEqual(['c2', 'c3']);
  });

  it('media CRUD', async () => {
    await store.putMedia([
      {
        id: 'm1',
        cardId: 'c1',
        side: 'front',
        kind: 'image',
        mime: 'image/png',
        bytes: 1,
        sort: 0,
        deletedAt: null,
      },
    ]);
    expect(await store.listMedia('c1')).toHaveLength(1);
  });

  it('outbox keeps order and removes acknowledged events', async () => {
    await store.appendOutbox(review('0002', 'c1'));
    await store.appendOutbox(review('0001', 'c1'));
    await store.appendOutbox(review('0003', 'c1'));
    expect((await store.listOutbox()).map((e) => e.id)).toEqual(['0001', '0002', '0003']);
    expect(await store.listOutbox(2)).toHaveLength(2);
    await store.removeOutbox(['0001', '0003']);
    expect((await store.listOutbox()).map((e) => e.id)).toEqual(['0002']);
  });

  it('sessions CRUD', async () => {
    const s: StoredSession = {
      id: 's1',
      deckId: 'd1',
      kind: 'review',
      nodeIndex: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      queue: ['c1'],
      position: 0,
      graded: {},
    };
    await store.putSession(s);
    expect(await store.getSession('s1')).toEqual(s);
    expect((await store.getActiveSession())?.id).toBe('s1');
    await store.deleteSession('s1');
    expect(await store.getActiveSession()).toBeUndefined();
  });

  it('daily activity CRUD', async () => {
    await store.putDailyActivity([
      {
        studyDay: '2026-01-01',
        reviews: 1,
        xp: 2,
        goalXp: 20,
        allAvailableDone: false,
        goalMet: false,
      },
    ]);
    expect(await store.listDailyActivity()).toHaveLength(1);
  });

  it('gradeTransaction updates the card and appends the event together', async () => {
    await store.putCards([card('c1')]);
    await store.gradeTransaction({
      card: card('c1', { state: 'learning' }),
      event: review('e1', 'c1'),
    });
    expect((await store.getCard('c1'))?.fsrs.state).toBe('learning');
    expect((await store.listOutbox()).map((e) => e.id)).toEqual(['e1']);
  });

  it('gradeTransaction is atomic: a failing write rolls back the card update', async () => {
    await store.putCards([card('c1')]);
    await store.appendOutbox(review('dup', 'c1'));
    await expect(
      store.gradeTransaction({ card: card('c1', { state: 'review' }), event: review('dup', 'c1') }),
    ).rejects.toThrow();
    expect((await store.getCard('c1'))?.fsrs.state).toBe('new');
  });

  it('applyPull writes rows, tombstones remove content, and saves the cursor', async () => {
    await store.putCards([card('c1')]);
    await store.applyPull({
      decks: [deck('a')],
      cards: [
        { ...card('c1'), front: '', back: '', deletedAt: '2026-01-02T00:00:00.000Z' },
        card('c2'),
      ],
      cursor: '9',
    });
    expect(await store.getCard('c1')).toBeUndefined();
    expect(await store.getCard('c2')).toBeDefined();
    expect(await store.getMeta('pullCursor')).toBe('9');
  });

  it('clearAll empties every store', async () => {
    await store.setMeta('deviceId', 'x');
    await store.putDecks([deck('a')]);
    await store.putCards([card('c1')]);
    await store.appendOutbox(review('e1', 'c1'));
    await store.putSession({
      id: 's1',
      deckId: 'd1',
      kind: 'review',
      nodeIndex: null,
      startedAt: 'x',
      queue: [],
      position: 0,
      graded: {},
    });
    await store.putDailyActivity([
      {
        studyDay: '2026-01-01',
        reviews: 1,
        xp: 2,
        goalXp: 20,
        allAvailableDone: false,
        goalMet: false,
      },
    ]);
    await store.clearAll();
    expect(await store.getMeta('deviceId')).toBeUndefined();
    expect(await store.listDecks()).toEqual([]);
    expect(await store.listCards('d1')).toEqual([]);
    expect(await store.listOutbox()).toEqual([]);
    expect(await store.getActiveSession()).toBeUndefined();
    expect(await store.listDailyActivity()).toEqual([]);
  });
});
