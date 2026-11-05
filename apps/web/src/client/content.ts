import type { Api } from './api';
import type { Card, Deck, LocalStore } from './local-store';

export interface ExportedFile {
  text: string;
  fileName: string;
}

/** `{deck-name}.anki-duo.json` with characters that file systems reject replaced by `-`. */
/* eslint-disable no-control-regex */
export const exportFileName = (deckName: string) =>
  `${deckName.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim() || 'deck'}.anki-duo.json`;
/* eslint-enable no-control-regex */

/**
 * Content edits are online-only (FR-017). Each action calls the API and, only on success, writes
 * the returned entity into LocalStore so the UI updates without waiting for the next pull.
 * A failed call throws an `ApiError` and leaves LocalStore alone.
 */
export function createContentActions(
  api: Api,
  store: LocalStore,
  now: () => Date = () => new Date(),
) {
  /** Removing rows locally reuses the tombstone path of `applyPull`. */
  const dropDeck = (deck: Deck) =>
    store.applyPull({ decks: [{ ...deck, deletedAt: now().toISOString() }] });
  const dropCard = (card: Card) =>
    store.applyPull({ cards: [{ ...card, deletedAt: now().toISOString() }] });

  return {
    async createDeck(body: { id?: string; name: string; newCardsPerDay?: number }) {
      const { data } = await api.POST('/decks', { body });
      await store.putDecks([data!]);
      return data!;
    },

    async updateDeck(deckId: string, body: { name?: string; newCardsPerDay?: number }) {
      const { data } = await api.PATCH('/decks/{deckId}', { params: { path: { deckId } }, body });
      await store.putDecks([data!]);
      return data!;
    },

    async deleteDeck(deckId: string) {
      await api.DELETE('/decks/{deckId}', { params: { path: { deckId } } });
      const deck = await store.getDeck(deckId);
      if (deck) await dropDeck(deck);
    },

    async createCard(
      deckId: string,
      body: { id?: string; front: string; back?: string; tags?: string[] },
    ) {
      const { data } = await api.POST('/decks/{deckId}/cards', {
        params: { path: { deckId } },
        body,
      });
      await store.putCards([data!]);
      return data!;
    },

    async updateCard(
      cardId: string,
      body: { front?: string; back?: string; tags?: string[]; suspended?: boolean },
    ) {
      const { data } = await api.PATCH('/cards/{cardId}', { params: { path: { cardId } }, body });
      await store.putCards([data!]);
      return data!;
    },

    async deleteCard(cardId: string) {
      await api.DELETE('/cards/{cardId}', { params: { path: { cardId } } });
      const card = await store.getCard(cardId);
      if (card) await dropCard(card);
    },

    async resetCard(cardId: string) {
      const { data } = await api.POST('/cards/{cardId}/reset', { params: { path: { cardId } } });
      await store.putCards([data!]);
      return data!;
    },

    async exportDeck(deck: Pick<Deck, 'id' | 'name'>): Promise<ExportedFile> {
      const { data } = await api.GET('/decks/{deckId}/export', {
        params: { path: { deckId: deck.id } },
      });
      return { text: JSON.stringify(data, null, 2), fileName: exportFileName(deck.name) };
    },

    async restoreDeck(file: unknown) {
      const { data } = await api.POST('/decks/restore', { body: file as never });
      await store.putDecks([data!]);
      return data!;
    },
  };
}

export type ContentActions = ReturnType<typeof createContentActions>;
