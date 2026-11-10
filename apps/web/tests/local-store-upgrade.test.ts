import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';

/** Opens a database with exactly the v2 schema shipped before feature 002 and seeds it. */
async function seedV2(name: string) {
  const v2 = new Dexie(name);
  v2.version(1).stores({
    meta: 'key',
    settings: 'userId',
    stats: 'userId',
    decks: 'id',
    cards: 'id, [deckId+state+due], [deckId+nodeIndex], deckId',
    media: 'id, cardId',
    outbox: 'id',
    sessions: 'id',
    dailyActivity: 'studyDay',
  });
  v2.version(2).stores({ noteTypes: 'id' });
  const fsrs = {
    state: 'review',
    due: '2026-03-01T00:00:00.000Z',
    stability: 5,
    difficulty: 5,
    learningSteps: 0,
    reps: 3,
    lapses: 1,
    lastReview: '2026-02-24T00:00:00.000Z',
  };
  const cards = [1, 2].map((n) => ({
    id: `c${n}`,
    deckId: 'd1',
    position: n,
    nodeIndex: 0,
    front: `f${n}`,
    back: `b${n}`,
    tags: ['t'],
    suspended: false,
    noteId: null,
    noteTypeId: null,
    templateId: null,
    format: 'markdown',
    fsrs,
    state: fsrs.state,
    due: fsrs.due,
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  }));
  const outbox = [
    {
      type: 'review',
      id: 'e1',
      cardId: 'c1',
      sessionId: 's1',
      grade: 3,
      reviewedAt: '2026-03-01T00:00:00.000Z',
      durationMs: 1200,
      studyAhead: false,
      schedulerVersion: 1,
      stateBefore: fsrs,
      stateAfter: { ...fsrs, reps: 4 },
    },
  ];
  const sessions = [
    {
      id: 's1',
      deckId: 'd1',
      kind: 'review',
      nodeIndex: null,
      startedAt: '2026-03-01T00:00:00.000Z',
      queue: ['c1', 'c2'],
      position: 1,
      graded: { c1: 3 },
    },
  ];
  const noteTypes = [
    { id: 'nt1', name: 'Basic', fields: [], templates: [], css: '', deletedAt: null },
  ];
  const decks = [
    { id: 'd1', name: 'D', newCardsPerDay: 20, createdAt: 'x', updatedAt: 'x', deletedAt: null },
  ];
  await v2.table('cards').bulkPut(cards);
  await v2.table('outbox').bulkPut(outbox);
  await v2.table('sessions').bulkPut(sessions);
  await v2.table('noteTypes').bulkPut(noteTypes);
  await v2.table('decks').bulkPut(decks);
  v2.close();
  return { cards, outbox, sessions, noteTypes, decks };
}

describe('Dexie v2 -> v3 upgrade (feature 002)', () => {
  it('keeps every row untouched, above all the outbox and card fsrs', async () => {
    const name = `upgrade-${Math.random()}`;
    const seeded = await seedV2(name);
    const store = new DexieStore(name);
    await store.open();
    expect(store.verno).toBe(3);
    const raw = async (t: string) => (await store.table(t).toArray()) as unknown[];
    expect(await raw('outbox')).toEqual(seeded.outbox);
    expect(await raw('sessions')).toEqual(seeded.sessions);
    expect(await raw('noteTypes')).toEqual(seeded.noteTypes);
    const rawCards = (await raw('cards')) as { id: string }[];
    expect(rawCards.sort((a, b) => a.id.localeCompare(b.id))).toEqual(seeded.cards);
    // v2 cards have none of the new fields stored.
    for (const c of rawCards) {
      expect(c).not.toHaveProperty('ordinal');
      expect(c).not.toHaveProperty('interaction');
      expect(c).not.toHaveProperty('answerText');
    }
    expect((await store.listOutbox()).map((e) => e.id)).toEqual(['e1']);
  });

  it('reads v2 cards, decks and settings with 0 / null / "" / false defaults', async () => {
    const name = `upgrade-${Math.random()}`;
    const seeded = await seedV2(name);
    const store = new DexieStore(name);
    const card = await store.getCard('c1');
    expect(card).toMatchObject({ ordinal: 0, interaction: null, answerText: '' });
    expect(card?.fsrs).toEqual(seeded.cards[0]!.fsrs);
    expect(
      (await store.listCards('d1')).every((c) => c.ordinal === 0 && c.interaction === null),
    ).toBe(true);
    expect((await store.getDeck('d1'))?.mcPractice).toBe(false);
    expect((await store.listDecks())[0]?.mcPractice).toBe(false);
  });
});
