import { buildQueue } from '@anki-duo/domain';
import { introducedToday, studyWindow } from './session/session-machine';
import type { Card, LocalStore, MediaAsset } from './local-store';

/** The service-worker media cache may hold at most 200 MB (plan: Limits). */
export const CACHE_LIMIT_BYTES = 200 * 1024 * 1024;
export const MEDIA_URL = (id: string) => `/api/v1/media/${id}`;

/** Media attached to the cards of today's queue (due and new), and nothing else. */
export function mediaForToday(queueCards: Pick<Card, 'id'>[], media: MediaAsset[]): MediaAsset[] {
  const ids = new Set(queueCards.map((c) => c.id));
  return media.filter((m) => !m.deletedAt && ids.has(m.cardId));
}

/** Ids of today's media that are not in the cache yet. */
export function prefetchPlan(today: MediaAsset[], cachedIds: ReadonlySet<string>): string[] {
  return today.filter((m) => !cachedIds.has(m.id)).map((m) => m.id);
}

export interface CacheEntry {
  id: string;
  bytes: number;
  cachedAt: number;
}

/**
 * Which cached media to drop so the cache fits `limitBytes`: oldest first, never anything needed
 * for today's queue. If today's media alone are over budget they all stay and `overBudget` is set.
 */
export function evictionPlan(input: {
  cached: CacheEntry[];
  todayIds: ReadonlySet<string>;
  limitBytes?: number;
}): { evict: string[]; overBudget: boolean } {
  const limit = input.limitBytes ?? CACHE_LIMIT_BYTES;
  let total = input.cached.reduce((n, c) => n + c.bytes, 0);
  const evict: string[] = [];
  for (const c of [...input.cached]
    .filter((c) => !input.todayIds.has(c.id))
    .sort((a, b) => a.cachedAt - b.cachedAt)) {
    if (total <= limit) break;
    evict.push(c.id);
    total -= c.bytes;
  }
  return { evict, overBudget: total > limit };
}

/** Messages understood by `sw.ts`. */
export type MediaMessage =
  | { type: 'PREFETCH_MEDIA'; ids: string[] }
  | { type: 'EVICT_MEDIA'; ids: string[] }
  | { type: 'MEDIA_INDEX' };

export interface MediaCacheTransport {
  /** The cache index from the service worker, or null when there is none (no SW, tests). */
  index(): Promise<CacheEntry[] | null>;
  post(message: MediaMessage): void;
}

export function swTransport(): MediaCacheTransport {
  const sw = () => navigator.serviceWorker?.controller ?? null;
  return {
    index: () =>
      new Promise((resolve) => {
        const target = sw();
        if (!target) return resolve(null);
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(null), 3000);
        channel.port1.onmessage = (e) => {
          clearTimeout(timer);
          resolve(e.data as CacheEntry[]);
        };
        target.postMessage({ type: 'MEDIA_INDEX' } satisfies MediaMessage, [channel.port2]);
      }),
    post: (m) => sw()?.postMessage(m),
  };
}

/** Today's cards across decks, using the same queue rules as a session. */
async function todaysCards(store: LocalStore, now: Date): Promise<Card[]> {
  const userId = (await store.getMeta('userId')) ?? '';
  const settings = await store.getSettings(userId);
  if (!settings) return [];
  const win = studyWindow(now, settings);
  const out: Card[] = [];
  for (const deck of (await store.listDecks()).filter((d) => !d.deletedAt)) {
    const cards = await store.listCards(deck.id);
    const ids = buildQueue({
      kind: 'review',
      cards: cards.map((c) => ({
        id: c.id,
        state: c.fsrs.state,
        due: new Date(c.fsrs.due),
        position: c.position,
        suspended: c.suspended,
        nodeIndex: c.nodeIndex,
      })),
      now,
      settings: { sessionSize: 1000, newCardsPerDay: deck.newCardsPerDay },
      studyDayEnd: win.end,
      introducedToday: introducedToday(cards, win.day, settings),
    });
    const wanted = new Set(ids);
    out.push(...cards.filter((c) => wanted.has(c.id)));
  }
  return out;
}

/** Run after each pull: prefetch what today needs, then evict to stay within the budget. */
export async function maintainMediaCache(
  store: LocalStore,
  transport: MediaCacheTransport,
  now = new Date(),
) {
  const cards = await todaysCards(store, now);
  const media: MediaAsset[] = [];
  for (const c of cards) media.push(...(await store.listMedia(c.id)));
  const today = mediaForToday(cards, media);
  const index = await transport.index();
  if (index === null) return;
  const missing = prefetchPlan(today, new Set(index.map((e) => e.id)));
  if (missing.length) transport.post({ type: 'PREFETCH_MEDIA', ids: missing });
  const { evict } = evictionPlan({ cached: index, todayIds: new Set(today.map((m) => m.id)) });
  if (evict.length) transport.post({ type: 'EVICT_MEDIA', ids: evict });
}
