import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';
import { createContentActions } from '../src/client/content';
import { ApiError } from '../src/client/api';

const deck = {
  id: 'd1',
  name: 'Deck',
  newCardsPerDay: 20,
  createdAt: 'x',
  updatedAt: 'x',
  deletedAt: null,
};
const card = (over = {}) => ({
  id: 'c1',
  deckId: 'd1',
  position: 0,
  nodeIndex: 0,
  front: 'f',
  back: 'b',
  tags: [],
  suspended: false,
  fsrs: {
    state: 'new' as const,
    due: '2026-01-01T00:00:00.000Z',
    stability: 0,
    difficulty: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  },
  updatedAt: 'x',
  deletedAt: null,
  ...over,
});

let store: DexieStore;
let api: Record<'GET' | 'POST' | 'PATCH' | 'DELETE', ReturnType<typeof vi.fn>>;
const actions = () =>
  createContentActions(api as never, store, () => new Date('2026-03-01T00:00:00Z'));

beforeEach(() => {
  store = new DexieStore(`content-${Math.random()}`);
  api = { GET: vi.fn(), POST: vi.fn(), PATCH: vi.fn(), DELETE: vi.fn() };
});

describe('content actions write the API result into LocalStore straight away (FR-017)', () => {
  it('createDeck / updateDeck', async () => {
    api.POST.mockResolvedValue({ data: deck });
    await actions().createDeck({ name: 'Deck' });
    expect(api.POST).toHaveBeenCalledWith(
      '/decks',
      expect.objectContaining({ body: expect.objectContaining({ name: 'Deck' }) }),
    );
    expect(await store.getDeck('d1')).toEqual(deck);
    api.PATCH.mockResolvedValue({ data: { ...deck, name: 'New' } });
    await actions().updateDeck('d1', { name: 'New' });
    expect((await store.getDeck('d1'))!.name).toBe('New');
  });

  it('deleteDeck removes the deck, its cards and media locally', async () => {
    await store.putDecks([deck]);
    await store.putCards([card()]);
    api.DELETE.mockResolvedValue({});
    await actions().deleteDeck('d1');
    expect(await store.getDeck('d1')).toBeUndefined();
    expect(await store.listCards('d1')).toEqual([]);
  });

  it('createCard / updateCard / resetCard store the returned card', async () => {
    api.POST.mockResolvedValue({ data: card() });
    await actions().createCard('d1', { front: 'f' });
    expect((await store.getCard('c1'))!.front).toBe('f');
    api.PATCH.mockResolvedValue({ data: card({ front: 'edited', suspended: true }) });
    await actions().updateCard('c1', { front: 'edited', suspended: true });
    expect(await store.getCard('c1')).toMatchObject({ front: 'edited', suspended: true });
    api.POST.mockResolvedValue({ data: card({ front: 'edited' }) });
    await actions().resetCard('c1');
    expect(api.POST).toHaveBeenLastCalledWith('/cards/{cardId}/reset', {
      params: { path: { cardId: 'c1' } },
    });
  });

  it('deleteCard drops the card from LocalStore', async () => {
    await store.putCards([card()]);
    api.DELETE.mockResolvedValue({});
    await actions().deleteCard('c1');
    expect(await store.getCard('c1')).toBeUndefined();
  });

  it('leaves LocalStore untouched when the API fails', async () => {
    api.POST.mockRejectedValue(new ApiError(409, 'deck_name_taken', 'taken'));
    await expect(actions().createDeck({ name: 'Deck' })).rejects.toMatchObject({
      code: 'deck_name_taken',
    });
    expect(await store.listDecks()).toEqual([]);
  });

  it('restoreDeck posts the parsed file and stores the new deck', async () => {
    api.POST.mockResolvedValue({ data: deck });
    const file = { format: 'anki-duo-export', version: 1 };
    await actions().restoreDeck(file);
    expect(api.POST).toHaveBeenCalledWith('/decks/restore', { body: file });
    expect(await store.getDeck('d1')).toBeTruthy();
  });

  it('exportDeck returns the file text and a safe file name', async () => {
    api.GET.mockResolvedValue({ data: { format: 'anki-duo-export' } });
    const out = await actions().exportDeck({ ...deck, name: 'Từ vựng/N3: "x"' });
    expect(JSON.parse(out.text)).toEqual({ format: 'anki-duo-export' });
    expect(out.fileName.endsWith('.anki-duo.json')).toBe(true);
    expect(out.fileName).not.toMatch(/[\\/:*?"<>|]/);
  });
});
