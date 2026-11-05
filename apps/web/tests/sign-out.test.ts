import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';
import { performSignOut } from '../src/client/sign-out';

let store: DexieStore;
beforeEach(async () => {
  store = new DexieStore(`so-${Math.random()}`);
  await store.setMeta('deviceId', 'd');
  await store.setMeta('userId', 'u');
  await store.putDecks([
    { id: 'd1', name: 'n', newCardsPerDay: 20, createdAt: 'x', updatedAt: 'x', deletedAt: null },
  ]);
  await store.putCards([
    {
      id: 'c1',
      deckId: 'd1',
      position: 0,
      nodeIndex: 0,
      front: 'f',
      back: '',
      tags: [],
      suspended: false,
      fsrs: {
        state: 'new',
        due: 'x',
        stability: 0,
        difficulty: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        lastReview: null,
      },
      updatedAt: 'x',
      deletedAt: null,
    },
  ]);
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
});

function fakeCaches(names: string[]) {
  const live = new Set(names);
  return {
    keys: async () => [...live],
    delete: async (n: string) => live.delete(n),
  };
}

describe('performSignOut', () => {
  it('empties every store and removes all caches, then signs out', async () => {
    const caches = fakeCaches(['media-v1', 'api-get-v1', 'workbox-precache-v2']);
    const signOut = vi.fn().mockResolvedValue(undefined);
    await performSignOut({ store, caches, signOut });
    expect(signOut).toHaveBeenCalled();
    expect(await store.getMeta('deviceId')).toBeUndefined();
    expect(await store.listDecks()).toEqual([]);
    expect(await store.listCards('d1')).toEqual([]);
    expect(await store.listDailyActivity()).toEqual([]);
    const left = await caches.keys();
    expect(left.filter((k) => /media|api/.test(k))).toEqual([]);
  });

  it('still wipes local data when the network sign-out fails', async () => {
    const signOut = vi.fn().mockRejectedValue(new Error('offline'));
    await performSignOut({ store, caches: fakeCaches(['media-v1']), signOut });
    expect(await store.listDecks()).toEqual([]);
  });

  it('works without the Cache API', async () => {
    await performSignOut({ store, caches: undefined, signOut: async () => {} });
    expect(await store.listDecks()).toEqual([]);
  });
});
