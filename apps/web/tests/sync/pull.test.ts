import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DexieStore } from '../../src/client/dexie-store';
import { pullAll } from '../../src/client/sync/pull';

const card = (id: string, deletedAt: string | null = null) => ({
  id,
  deckId: 'd1',
  position: 0,
  nodeIndex: 0,
  front: deletedAt ? '' : 'f',
  back: '',
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
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt,
});
const page = (over: object) => ({
  cursor: '0',
  hasMore: false,
  settings: null,
  stats: null,
  decks: [],
  cards: [],
  media: [],
  dailyActivity: [],
  ...over,
});

let store: DexieStore;
beforeEach(async () => {
  store = new DexieStore(`pull-${Math.random()}`);
  await store.setMeta('deviceId', 'dev-1');
});

describe('pullAll', () => {
  it('pages until hasMore is false, passing the previous cursor', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: page({ cursor: '5', hasMore: true, cards: [card('c1')] }) })
      .mockResolvedValueOnce({ data: page({ cursor: '9', hasMore: false, cards: [card('c2')] }) });
    await pullAll(store, { GET: get } as never);
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]![1].params.query).toMatchObject({ cursor: '0', deviceId: 'dev-1' });
    expect(get.mock.calls[1]![1].params.query.cursor).toBe('5');
    expect(await store.getCard('c1')).toBeDefined();
    expect(await store.getCard('c2')).toBeDefined();
  });

  it('persists pullCursor', async () => {
    const get = vi.fn().mockResolvedValue({ data: page({ cursor: '42' }) });
    await pullAll(store, { GET: get } as never);
    expect(await store.getMeta('pullCursor')).toBe('42');
    await pullAll(store, { GET: get } as never);
    expect(get.mock.calls[1]![1].params.query.cursor).toBe('42');
  });

  it('applies tombstones', async () => {
    await store.putCards([card('c1')]);
    const get = vi.fn().mockResolvedValue({
      data: page({
        cursor: '3',
        cards: [card('c1', '2026-01-02T00:00:00.000Z')],
        decks: [
          {
            id: 'd9',
            name: '',
            newCardsPerDay: 20,
            createdAt: 'x',
            updatedAt: 'x',
            deletedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      }),
    });
    await pullAll(store, { GET: get } as never);
    expect(await store.getCard('c1')).toBeUndefined();
    expect(await store.getDeck('d9')).toBeUndefined();
  });

  it('writes settings, stats, decks, daily activity', async () => {
    await store.setMeta('userId', 'u1');
    const settings = {
      locale: 'en',
      timeZone: 'UTC',
      dayStartHour: 4,
      desiredRetention: 0.9,
      maximumIntervalDays: 36500,
      dailyXpGoal: 20,
      sessionSize: 20,
      soundEnabled: true,
      motion: 'system',
    };
    const get = vi.fn().mockResolvedValue({
      data: page({
        settings,
        decks: [
          {
            id: 'd1',
            name: 'D',
            newCardsPerDay: 20,
            createdAt: 'x',
            updatedAt: 'x',
            deletedAt: null,
          },
        ],
        dailyActivity: [
          {
            studyDay: '2026-01-01',
            reviews: 1,
            xp: 2,
            goalXp: 20,
            allAvailableDone: false,
            goalMet: false,
          },
        ],
      }),
    });
    await pullAll(store, { GET: get } as never);
    expect(await store.getSettings('u1')).toEqual(settings);
    expect(await store.listDecks()).toHaveLength(1);
    expect(await store.listDailyActivity()).toHaveLength(1);
  });

  it('leaves the cursor untouched when a request fails', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ data: page({ cursor: '5', hasMore: true }) })
      .mockRejectedValueOnce(new Error('offline'));
    await expect(pullAll(store, { GET: get } as never)).rejects.toThrow('offline');
    expect(await store.getMeta('pullCursor')).toBe('5');
  });
});
