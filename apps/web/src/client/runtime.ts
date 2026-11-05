import { v7 as uuidv7 } from 'uuid';
import { api } from './api';
import { connectivity } from './connectivity';
import { dexieStore } from './store';
import { maintainMediaCache, swTransport } from './media-cache';
import { createContentActions } from './content';
import { createSyncEngine } from './sync/sync-engine';
import { reporter } from './report';
import type { LocalStore } from './local-store';

/** Device id is created on first launch and kept in IndexedDB; userId lets `applyPull` key settings. */
export async function ensureIdentity(store: LocalStore, userId: string): Promise<string> {
  let deviceId = await store.getMeta('deviceId');
  if (!deviceId) {
    deviceId = uuidv7();
    await store.setMeta('deviceId', deviceId);
  }
  if ((await store.getMeta('userId')) !== userId) await store.setMeta('userId', userId);
  return deviceId;
}

/** The app-wide sync engine. */
export const syncEngine = createSyncEngine({
  store: dexieStore,
  api,
  connectivity,
  afterPull: () => maintainMediaCache(dexieStore, swTransport()),
  // Being offline is normal; anything else is worth knowing about.
  onError: (e) => {
    if ((e as { code?: string }).code !== 'network_error') {
      void reporter.report('sync_failure', e instanceof Error ? e.message : String(e));
    }
  },
});
export const newId = () => uuidv7();

/** Online-only content actions (decks, cards, import helpers) that mirror results into LocalStore. */
export const content = createContentActions(api, dexieStore);
