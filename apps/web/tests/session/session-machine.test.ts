import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../../src/client/dexie-store';
import type { Card, Deck, ReviewEvent, SessionEvent, Settings } from '../../src/client/local-store';
import { SessionMachine, type SessionDeps } from '../../src/client/session/session-machine';

const settings: Settings = {
  locale: 'en',
  timeZone: 'UTC',
  dayStartHour: 0,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  dailyXpGoal: 20,
  sessionSize: 20,
  soundEnabled: true,
  motion: 'system',
};
const deck: Deck = {
  id: 'd1',
  name: 'Deck',
  newCardsPerDay: 20,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};
const NOW = '2026-03-01T12:00:00.000Z';

const dueCard = (n: number): Card => ({
  id: `c${n}`,
  deckId: 'd1',
  position: n,
  nodeIndex: 0,
  front: `front ${n}`,
  back: `back ${n}`,
  tags: [],
  suspended: false,
  fsrs: {
    state: 'review',
    due: `2026-03-01T0${n}:00:00.000Z`,
    stability: 5,
    difficulty: 5,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    lastReview: '2026-02-24T00:00:00.000Z',
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});
const futureCard = (n: number): Card => ({
  ...dueCard(n),
  id: `f${n}`,
  fsrs: { ...dueCard(n).fsrs, due: '2026-03-10T00:00:00.000Z' },
});

let store: DexieStore;
let clock: number;
let ids: number;
let deps: SessionDeps;
beforeEach(() => {
  store = new DexieStore(`session-${Math.random()}`);
  clock = Date.parse(NOW);
  ids = 0;
  deps = {
    store,
    now: () => new Date(clock),
    newId: () => `00000000-0000-7000-8000-${String(++ids).padStart(12, '0')}`,
  };
});

const start = async (cards: Card[], kind: 'review' | 'ahead' = 'review') => {
  await store.putCards(cards);
  return SessionMachine.start(deps, { deck, kind, settings });
};
const outbox = async () => store.listOutbox();

describe('session machine', () => {
  it('queues due cards by due date and shows the first on its front', async () => {
    const m = await start([dueCard(3), dueCard(1), dueCard(2)]);
    const s = m.getState();
    expect(s.status).toBe('front');
    expect(s.card?.id).toBe('c1');
    expect(s.progress).toEqual({ done: 0, total: 3 });
  });

  it('emits an unfinished SessionEvent on start', async () => {
    await start([dueCard(1)]);
    const ev = (await outbox()).find((e) => e.type === 'session') as SessionEvent;
    expect(ev).toMatchObject({
      deckId: 'd1',
      kind: 'review',
      plannedCount: 1,
      completed: false,
      endedAt: null,
    });
  });

  it('reveal shows four interval previews, ordered Again <= Hard <= Good <= Easy (FR-002)', async () => {
    const m = await start([dueCard(1)]);
    m.reveal();
    const s = m.getState();
    expect(s.status).toBe('back');
    const p = s.previews!;
    expect([p.again, p.hard, p.good, p.easy].every((n) => n > 0)).toBe(true);
    expect(p.again).toBeLessThanOrEqual(p.hard);
    expect(p.hard).toBeLessThanOrEqual(p.good);
    expect(p.good).toBeLessThanOrEqual(p.easy);
  });

  it('grading advances synchronously, before gradeTransaction resolves (FR-016)', async () => {
    const m = await start([dueCard(1), dueCard(2)]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = vi.spyOn(store, 'gradeTransaction').mockImplementation(() => gate);
    m.reveal();
    m.grade(3);
    expect(m.getState().card?.id).toBe('c2');
    expect(m.getState().status).toBe('front');
    expect(spy).toHaveBeenCalledOnce();
    release();
    await m.settled();
  });

  it('writes the card update and a review event with the scheduler result', async () => {
    const m = await start([dueCard(1)]);
    clock += 4000;
    m.reveal();
    m.grade(3);
    await m.settled();
    const review = (await outbox()).find((e) => e.type === 'review') as ReviewEvent;
    expect(review).toMatchObject({ cardId: 'c1', grade: 3, durationMs: 4000, studyAhead: false });
    expect(review.stateBefore.state).toBe('review');
    const saved = await store.getCard('c1');
    expect(saved?.fsrs).toEqual(review.stateAfter);
    expect(new Date(saved!.fsrs.due).getTime()).toBeGreaterThan(clock);
  });

  it('a card graded Again returns after three other cards; progress counts it once (Story 1 #6)', async () => {
    const m = await start([dueCard(1), dueCard(2), dueCard(3), dueCard(4), dueCard(5)]);
    m.reveal();
    m.grade(1);
    const order: string[] = [];
    while (m.getState().status !== 'done' && order.length < 10) {
      const s = m.getState();
      order.push(s.card!.id);
      expect(s.progress.total).toBe(5);
      m.reveal();
      m.grade(3);
    }
    expect(order).toEqual(['c2', 'c3', 'c4', 'c1', 'c5']);
    expect(m.getState().progress).toEqual({ done: 5, total: 5 });
  });

  it('undo restores the previous card and drops the unsent outbox event (FR-008)', async () => {
    const original = dueCard(1);
    const m = await start([original, dueCard(2)]);
    m.reveal();
    m.grade(3);
    await m.settled();
    await m.undo();
    const s = m.getState();
    expect(s.card?.id).toBe('c1');
    expect(s.status).toBe('front');
    expect(s.progress.done).toBe(0);
    expect((await outbox()).filter((e) => e.type === 'review')).toEqual([]);
    expect((await store.getCard('c1'))?.fsrs).toEqual(original.fsrs);
  });

  it('undo after the event was pushed emits a revoke (R7)', async () => {
    const m = await start([dueCard(1), dueCard(2)]);
    m.reveal();
    m.grade(3);
    await m.settled();
    const review = (await outbox()).find((e) => e.type === 'review')!;
    await store.removeOutbox([review.id]); // the engine pushed it
    clock += 1000;
    await m.undo();
    const revoke = (await outbox()).find((e) => e.type === 'revoke');
    expect(revoke).toMatchObject({ reviewId: review.id, revokedAt: new Date(clock).toISOString() });
    expect(m.getState().card?.id).toBe('c1');
  });

  it('only the last grade can be undone', async () => {
    const m = await start([dueCard(1), dueCard(2), dueCard(3)]);
    m.reveal();
    m.grade(3);
    await m.settled();
    await m.undo();
    await m.undo(); // nothing left to undo
    expect(m.getState().card?.id).toBe('c1');
    expect(m.canUndo()).toBe(false);
  });

  it('resumes from LocalStore.sessions after a reload (FR-019)', async () => {
    const m = await start([dueCard(1), dueCard(2), dueCard(3)]);
    m.reveal();
    m.grade(3);
    await m.settled();
    const again = await SessionMachine.resume(deps, { deck, settings });
    expect(again).not.toBeNull();
    expect(again!.getState().card?.id).toBe('c2');
    expect(again!.getState().progress).toEqual({ done: 1, total: 3 });
    expect(again!.canUndo()).toBe(true);
  });

  it('resume returns null when nothing is in progress', async () => {
    expect(await SessionMachine.resume(deps, { deck, settings })).toBeNull();
  });

  it('finishes with a summary: cards, accuracy (grade >= 2), time and XP (Story 1 #5)', async () => {
    const m = await start([dueCard(1), dueCard(2)]);
    clock += 3000;
    m.reveal();
    m.grade(1);
    // Again re-queues c1; grade it Good the second time.
    clock += 2000;
    m.reveal();
    m.grade(3);
    clock += 1000;
    m.reveal();
    m.grade(4);
    await m.settled();
    const s = m.getState();
    expect(s.status).toBe('done');
    expect(s.summary).toEqual({
      cardsReviewed: 2,
      reviews: 3,
      accuracy: 2 / 3,
      durationMs: 6000,
      xp: 3 * 2 + 5,
    });
    const end = (await outbox()).find((e) => e.type === 'session') as SessionEvent;
    expect(end).toMatchObject({ completed: true, cardsReviewed: 2, correctCount: 2 });
    expect(end.endedAt).toBe(new Date(clock).toISOString());
    expect(await store.getActiveSession()).toBeUndefined();
  });

  it('study-ahead sessions flag every review and earn no XP', async () => {
    const m = await start([futureCard(1)], 'ahead');
    expect(m.getState().card?.id).toBe('f1');
    m.reveal();
    m.grade(3);
    await m.settled();
    const review = (await outbox()).find((e) => e.type === 'review') as ReviewEvent;
    expect(review.studyAhead).toBe(true);
    expect(m.getState().summary?.xp).toBe(0);
  });

  it('an empty queue gives the empty state and records nothing', async () => {
    const m = await start([futureCard(1)]);
    expect(m.getState().status).toBe('empty');
    expect(await outbox()).toEqual([]);
    expect(await store.getActiveSession()).toBeUndefined();
  });

  it('reports a failed save instead of swallowing it', async () => {
    const onError = vi.fn();
    deps.onError = onError;
    const m = await start([dueCard(1), dueCard(2)]);
    vi.spyOn(store, 'gradeTransaction').mockRejectedValue(new Error('quota'));
    m.reveal();
    m.grade(3);
    await m.settled();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('combined session over several decks', () => {
  const deck2: Deck = { ...deck, id: 'd2', name: 'Deck 2', newCardsPerDay: 1 };
  const newCard = (id: string, deckId: string, n: number): Card => ({
    ...dueCard(1),
    id,
    deckId,
    position: n,
    fsrs: {
      state: 'new',
      due: '2026-01-01T00:00:00.000Z',
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    },
  });
  const inD2 = (c: Card, id: string): Card => ({ ...c, id, deckId: 'd2' });
  const startAll = async (cards: Card[], size = 20) => {
    await store.putCards(cards);
    return SessionMachine.start(deps, {
      decks: [deck, deck2],
      kind: 'review',
      settings: { ...settings, sessionSize: size },
    });
  };

  it('puts due cards of every deck before new cards and respects each deck new-card limit', async () => {
    const m = await startAll([
      newCard('n1', 'd1', 1),
      newCard('n2', 'd1', 2),
      newCard('m1', 'd2', 1),
      newCard('m2', 'd2', 2),
      inD2(dueCard(2), 'x2'),
      dueCard(1),
    ]);
    const order: string[] = [];
    while (m.getState().status !== 'done') {
      const id = m.getState().card!.id;
      if (!order.includes(id)) order.push(id);
      m.grade(3);
    }
    // d2 allows one new card per day; d1 allows both of its own
    expect(order.slice(0, 2).sort()).toEqual(['c1', 'x2']);
    expect(order.slice(2).sort()).toEqual(['m1', 'n1', 'n2']);
  });

  it('caps the total at the session size', async () => {
    const m = await startAll([dueCard(1), dueCard(2), inD2(dueCard(3), 'x3')], 2);
    expect(m.getState().progress.total).toBe(2);
  });

  it('anchors the session event on the first queued card deck and keeps review deckIds', async () => {
    const m = await startAll([inD2(dueCard(1), 'x1'), newCard('n1', 'd1', 1)]);
    const ev = (await outbox()).find((e) => e.type === 'session') as SessionEvent;
    expect(ev.deckId).toBe('d2');
    while (m.getState().status !== 'done') m.grade(3);
    await m.settled();
    const events = await outbox();
    const sessions = events.filter((e) => e.type === 'session') as SessionEvent[];
    expect(sessions.every((e) => e.deckId === 'd2')).toBe(true);
    expect(sessions.at(-1)!.completed).toBe(true);
    expect(m.getReviewedCards().map((r) => [r.card.id, r.lastGrade])).toEqual([
      ['x1', 3],
      ['n1', 3],
    ]);
  });

  it('resumes only from the matching kind of route', async () => {
    await startAll([dueCard(1), inD2(dueCard(2), 'x2')]);
    expect(await SessionMachine.resume(deps, { deck, settings })).toBeNull();
    const m = await SessionMachine.resume(deps, { multi: true, settings });
    expect(m?.getState().progress.total).toBe(2);
    expect(m?.getState().card?.id).toBe('c1');
  });

  it('a single-deck session is not resumed by the combined route', async () => {
    await start([dueCard(1)]);
    expect(await SessionMachine.resume(deps, { multi: true, settings })).toBeNull();
    expect(await SessionMachine.resume(deps, { deck, settings })).not.toBeNull();
  });
});
