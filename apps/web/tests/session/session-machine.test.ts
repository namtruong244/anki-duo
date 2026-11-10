import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../../src/client/dexie-store';
import type { Card, Deck, ReviewEvent, SessionEvent, Settings } from '../../src/client/local-store';
import {
  SessionMachine,
  effectiveAnswer,
  type SessionDeps,
} from '../../src/client/session/session-machine';

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
  autoGrade: false,
};
const deck: Deck = {
  id: 'd1',
  name: 'Deck',
  newCardsPerDay: 20,
  mcPractice: false,
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
  noteId: null,
  noteTypeId: null,
  templateId: null,
  ordinal: 0,
  interaction: null,
  answerText: '',
  format: 'markdown' as const,
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
  it('replaceContent merges edited content but keeps scheduling state', async () => {
    const m = await start([dueCard(1)]);
    const before = m.getState().card!;
    const v = m.version;
    m.replaceContent({
      ...before,
      front: 'new front',
      back: 'new back',
      tags: ['x'],
      updatedAt: '2026-03-01T13:00:00.000Z',
      fsrs: { ...before.fsrs, stability: 999 },
    });
    const after = m.getState().card!;
    expect(after).toMatchObject({ front: 'new front', back: 'new back', tags: ['x'] });
    expect(after.updatedAt).toBe('2026-03-01T13:00:00.000Z');
    expect(after.fsrs).toEqual(before.fsrs);
    expect(m.version).toBeGreaterThan(v);
    m.replaceContent({ ...before, id: 'nope', front: 'z' });
    expect(m.version).toBe(v + 1);
  });

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

describe('session machine: answering (interactive cards)', () => {
  const typeAnswer = {
    kind: 'type',
    expected: 'cat',
    ignoreCase: true,
    ignoreDiacritics: true,
  } as const;
  const interactive = (n: number, answer: Card['interaction'] = null): Card => ({
    ...dueCard(n),
    interaction: answer,
  });
  const typeCard = (n: number) =>
    interactive(n, { v: 1, slots: [{ kind: 'type' }], answer: typeAnswer });
  const choiceCard = (n: number) =>
    interactive(n, {
      v: 1,
      slots: [{ kind: 'choice' }],
      answer: { kind: 'choice', correct: 'a', wrong: ['b'], explanationHtml: '' },
    });
  const occlusionCard = (n: number) =>
    interactive(n, {
      v: 1,
      slots: [{ kind: 'occlusion' }],
      answer: { kind: 'occlusion', image: 'i', mode: 'hide_all', masks: [], target: 1 },
    });

  it('type and choice cards start in answering with no suggestion', async () => {
    for (const make of [typeCard, choiceCard]) {
      const m = await start([make(1)]);
      const s = m.getState();
      expect(s.status).toBe('answering');
      expect(s.suggested).toBeNull();
      expect(s.answer).toBeNull();
    }
  });

  it.each([
    ['occlusion', () => occlusionCard(1)],
    ['null-answer', () => interactive(1, { v: 1, slots: [], answer: null })],
    ['basic', () => dueCard(1)],
  ])('%s cards use reveal() with suggested = null', async (_name, make) => {
    const m = await start([make()]);
    expect(m.getState().status).toBe('front');
    m.reveal();
    expect(m.getState()).toMatchObject({ status: 'back', suggested: null });
  });

  it('reveal() does nothing while answering', async () => {
    const m = await start([typeCard(1)]);
    m.reveal();
    expect(m.getState().status).toBe('answering');
  });

  it('submitAnswer moves to back and exposes the suggested grade', async () => {
    const m = await start([typeCard(1)]);
    m.submitAnswer({ verdict: 'almost', given: 'cot' });
    const s = m.getState();
    expect(s.status).toBe('back');
    expect(s.suggested).toBe(2);
    expect(s.answer).toEqual({ verdict: 'almost', given: 'cot', suggested: 2 });
    expect(s.previews).not.toBeNull();
    m.submitAnswer({ verdict: 'correct', given: 'cat' });
    expect(m.getState().suggested).toBe(2);
  });

  it('a null verdict suggests nothing', async () => {
    const m = await start([choiceCard(1)]);
    m.submitAnswer({ verdict: null });
    expect(m.getState()).toMatchObject({ status: 'back', suggested: null });
  });

  it('grade() submits only the chosen grade; the review event shape is unchanged (FR-010)', async () => {
    const m = await start([typeCard(1), dueCard(2)]);
    m.submitAnswer({ verdict: 'wrong', given: 'dog' });
    m.grade(4);
    await m.settled();
    const review = (await outbox()).find((e) => e.type === 'review') as ReviewEvent;
    expect(review.grade).toBe(4);
    expect(Object.keys(review).sort()).toEqual(
      [
        'type',
        'id',
        'cardId',
        'sessionId',
        'grade',
        'reviewedAt',
        'durationMs',
        'studyAhead',
        'schedulerVersion',
        'stateBefore',
        'stateAfter',
      ].sort(),
    );
    expect(m.getState()).toMatchObject({ status: 'front', answer: null, suggested: null });
  });

  it('the next interactive card is in answering after a grade', async () => {
    const m = await start([typeCard(1), typeCard(2)]);
    m.submitAnswer({ verdict: 'correct' });
    m.grade(3);
    expect(m.getState()).toMatchObject({ status: 'answering', card: { id: 'c2' } });
  });

  it('autoGrade grades the suggestion at once and holds the back until continue()', async () => {
    await store.putCards([typeCard(1), dueCard(2)]);
    const m = await SessionMachine.start(deps, {
      deck,
      kind: 'review',
      settings: { ...settings, autoGrade: true },
    });
    m.submitAnswer({ verdict: 'correct', given: 'cat' });
    await m.settled();
    const s = m.getState();
    expect(s).toMatchObject({ status: 'back', continuing: true, card: { id: 'c1' }, suggested: 3 });
    expect(s.progress.done).toBe(1);
    const reviews = (await outbox()).filter((e) => e.type === 'review') as ReviewEvent[];
    expect(reviews.map((r) => r.grade)).toEqual([3]);
    m.continue();
    expect(m.getState()).toMatchObject({ status: 'front', continuing: false, card: { id: 'c2' } });
  });

  it('autoGrade holds the back of the last card, then finishes on continue()', async () => {
    await store.putCards([typeCard(1)]);
    const m = await SessionMachine.start(deps, {
      deck,
      kind: 'review',
      settings: { ...settings, autoGrade: true },
    });
    m.submitAnswer({ verdict: 'correct' });
    expect(m.getState()).toMatchObject({ status: 'back', continuing: true });
    m.continue();
    expect(m.getState().status).toBe('done');
  });

  it('autoGrade does not grade when there is no suggestion', async () => {
    await store.putCards([choiceCard(1)]);
    const m = await SessionMachine.start(deps, {
      deck,
      kind: 'review',
      settings: { ...settings, autoGrade: true },
    });
    m.submitAnswer({ verdict: null });
    expect(m.getState()).toMatchObject({ status: 'back', continuing: false });
    expect((await outbox()).some((e) => e.type === 'review')).toBe(false);
  });

  it('undo() returns the card to answering with the answer cleared (FR-012)', async () => {
    const m = await start([typeCard(1), dueCard(2)]);
    m.submitAnswer({ verdict: 'correct', given: 'cat' });
    m.grade(3);
    await m.undo();
    expect(m.getState()).toMatchObject({
      status: 'answering',
      card: { id: 'c1' },
      answer: null,
      suggested: null,
    });
  });

  it('undo() after an auto-grade drops the held back and re-asks', async () => {
    await store.putCards([typeCard(1)]);
    const m = await SessionMachine.start(deps, {
      deck,
      kind: 'review',
      settings: { ...settings, autoGrade: true },
    });
    m.submitAnswer({ verdict: 'correct' });
    await m.undo();
    expect(m.getState()).toMatchObject({ status: 'answering', continuing: false, answer: null });
  });

  it('a reload restores the persisted answer on the feedback screen (R7)', async () => {
    const m = await start([typeCard(1)]);
    m.submitAnswer({ verdict: 'almost', given: 'cot' });
    await m.settled();
    const resumed = await SessionMachine.resume(deps, { deck, settings });
    const s = resumed!.getState();
    expect(s.status).toBe('back');
    expect(s.answer).toEqual({ verdict: 'almost', given: 'cot', suggested: 2 });
    expect(s.suggested).toBe(2);
    expect(s.previews).not.toBeNull();
    resumed!.grade(2);
    expect(resumed!.getState().answer).toBeNull();
  });

  it('effectiveAnswer defaults to the interaction answer', () => {
    expect(effectiveAnswer(typeCard(1), { settings })).toEqual(typeAnswer);
    expect(effectiveAnswer(dueCard(1), { settings })).toBeNull();
  });
});
