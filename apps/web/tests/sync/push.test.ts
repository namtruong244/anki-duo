import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../src/client/api';
import { DexieStore } from '../../src/client/dexie-store';
import type { ReviewEvent } from '../../src/client/local-store';
import { pushOutbox } from '../../src/client/sync/push';
import { createSyncEngine } from '../../src/client/sync/sync-engine';
import { createConnectivity } from '../../src/client/connectivity';

const state = {
  state: 'new' as const,
  due: '2026-01-01T00:00:00.000Z',
  stability: 0,
  difficulty: 0,
  learningSteps: 0,
  reps: 0,
  lapses: 0,
  lastReview: null,
};
const ev = (n: number): ReviewEvent => ({
  type: 'review',
  // zero-padded so ids sort like UUIDv7s
  id: `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  cardId: 'c1',
  sessionId: 's1',
  grade: 3,
  reviewedAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1000,
  studyAhead: false,
  schedulerVersion: 'v',
  stateBefore: state,
  stateAfter: state,
});
const emptyPull = {
  data: {
    cursor: '1',
    hasMore: false,
    settings: null,
    stats: null,
    decks: [],
    cards: [],
    media: [],
    dailyActivity: [],
  },
};

let store: DexieStore;
beforeEach(async () => {
  store = new DexieStore(`push-${Math.random()}`);
  await store.setMeta('deviceId', 'dev-1');
});
afterEach(() => vi.useRealTimers());

/** IndexedDB (fake-indexeddb) needs real event-loop turns; only the timers are faked. */
const flush = async () => {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
};
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await flush();
};

const ackAll = (body: { events: { id: string }[] }) => ({
  data: { results: body.events.map((e) => ({ id: e.id, status: 'applied' })) },
});

describe('pushOutbox', () => {
  it('pushes in batches of at most 500 and removes acknowledged events', async () => {
    for (let i = 1; i <= 1200; i++) await store.appendOutbox(ev(i));
    const post = vi.fn(async (_p: string, init: { body: { events: { id: string }[] } }) =>
      ackAll(init.body),
    );
    await pushOutbox(store, { POST: post } as never);
    expect(post.mock.calls.map((c) => c[1].body.events.length)).toEqual([500, 500, 200]);
    expect(await store.listOutbox()).toEqual([]);
  });

  it('sends the device id and events oldest first', async () => {
    await store.appendOutbox(ev(2));
    await store.appendOutbox(ev(1));
    const post = vi.fn(async (_p: string, init: { body: { events: { id: string }[] } }) =>
      ackAll(init.body),
    );
    await pushOutbox(store, { POST: post } as never);
    const body = post.mock.calls[0]![1].body as { deviceId: string; events: { id: string }[] };
    expect(body.deviceId).toBe('dev-1');
    expect(body.events.map((e) => e.id)).toEqual([ev(1).id, ev(2).id]);
  });

  it('removes duplicates too', async () => {
    await store.appendOutbox(ev(1));
    const post = vi.fn(async () => ({
      data: { results: [{ id: ev(1).id, status: 'duplicate' }] },
    }));
    await pushOutbox(store, { POST: post } as never);
    expect(await store.listOutbox()).toEqual([]);
  });

  it('removes rejected events and reports them to /client-events', async () => {
    await store.appendOutbox(ev(1));
    await store.appendOutbox(ev(2));
    const post = vi.fn(async (path: string, init: { body: unknown }) => {
      if (path === '/client-events') return { data: undefined };
      return {
        data: {
          results: [
            { id: ev(1).id, status: 'rejected', code: 'card_not_found' },
            { id: ev(2).id, status: 'applied' },
          ],
        },
      };
      void init;
    });
    await pushOutbox(store, { POST: post } as never);
    expect(await store.listOutbox()).toEqual([]);
    const report = post.mock.calls.find((c) => c[0] === '/client-events')!;
    expect(report[1]).toMatchObject({
      body: { kind: 'sync_failure', context: { eventId: ev(1).id, code: 'card_not_found' } },
    });
  });

  it('keeps events when the network fails', async () => {
    await store.appendOutbox(ev(1));
    const post = vi.fn(async () => {
      throw new ApiError(0, 'network_error', 'down');
    });
    await expect(pushOutbox(store, { POST: post } as never)).rejects.toBeInstanceOf(ApiError);
    expect(await store.listOutbox()).toHaveLength(1);
  });

  it('does nothing for an empty outbox', async () => {
    const post = vi.fn();
    await pushOutbox(store, { POST: post } as never);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('sync engine', () => {
  const setup = (opts: { visible?: () => boolean } = {}) => {
    const post = vi.fn(async (_p: string, init: { body: { events: { id: string }[] } }) =>
      ackAll(init.body),
    );
    const get = vi.fn(async () => emptyPull);
    const target = new EventTarget();
    const connectivity = createConnectivity({ target, initial: true });
    const engine = createSyncEngine({
      store,
      api: { POST: post, GET: get } as never,
      connectivity,
      isVisible: opts.visible ?? (() => true),
    });
    return { post, get, target, connectivity, engine };
  };

  it('syncs on start, then pulls after the push', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await store.appendOutbox(ev(1));
    const { post, get, engine } = setup();
    await engine.start();
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
    expect(post.mock.invocationCallOrder[0]!).toBeLessThan(get.mock.invocationCallOrder[0]!);
    engine.stop();
  });

  it('syncs every 30 s while visible and online, and not when hidden', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let visible = true;
    const { get, engine } = setup({ visible: () => visible });
    await engine.start();
    get.mockClear();
    await advance(30_000);
    expect(get).toHaveBeenCalledTimes(1);
    visible = false;
    await advance(60_000);
    expect(get).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('syncs when the connection comes back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { get, target, engine } = setup();
    await engine.start();
    target.dispatchEvent(new Event('offline'));
    get.mockClear();
    target.dispatchEvent(new Event('online'));
    await advance(0);
    expect(get).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('syncs after a session ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { get, engine } = setup();
    await engine.start();
    get.mockClear();
    await engine.syncAfterSession();
    expect(get).toHaveBeenCalledTimes(1);
    engine.stop();
  });

  it('retries network errors with exponential backoff capped at 60 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await store.appendOutbox(ev(1));
    const post = vi.fn(async () => {
      throw new ApiError(0, 'network_error', 'down');
    });
    const engine = createSyncEngine({
      store,
      api: { POST: post, GET: vi.fn() } as never,
      connectivity: createConnectivity({ target: new EventTarget(), initial: true }),
      isVisible: () => false,
    });
    await engine.start();
    expect(post).toHaveBeenCalledTimes(1);
    const delays = [1000, 2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000];
    for (const [i, d] of delays.entries()) {
      await advance(d - 1);
      expect(post).toHaveBeenCalledTimes(i + 1);
      await advance(1);
      expect(post).toHaveBeenCalledTimes(i + 2);
    }
    engine.stop();
  });

  it('reports status: syncing, idle, error', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { engine } = setup();
    const seen: string[] = [];
    engine.subscribe((s) => seen.push(s));
    await engine.start();
    expect(seen).toContain('syncing');
    expect(seen.at(-1)).toBe('idle');
    engine.stop();
  });
});
