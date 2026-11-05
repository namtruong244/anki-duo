import type { Api } from '../api';
import type { LocalStore } from '../local-store';

/** Pulls every change since the stored cursor, page by page, applying each page atomically. */
export async function pullAll(store: LocalStore, api: Pick<Api, 'GET'>): Promise<void> {
  const deviceId = (await store.getMeta('deviceId')) ?? '';
  for (;;) {
    const cursor = (await store.getMeta('pullCursor')) ?? '0';
    const { data } = await api.GET('/sync/pull', { params: { query: { cursor, deviceId } } });
    if (!data) throw new Error('empty pull response');
    await store.applyPull({
      settings: data.settings,
      stats: data.stats,
      decks: data.decks,
      cards: data.cards,
      media: data.media,
      dailyActivity: data.dailyActivity,
      cursor: data.cursor,
    });
    if (!data.hasMore) break;
  }
  await store.setMeta('lastSyncAt', new Date().toISOString());
}
