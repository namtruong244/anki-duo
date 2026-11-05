import { v7 as uuidv7 } from 'uuid';
import { api } from './api';
import { connectivity } from './connectivity';
import { dexieStore } from './store';
import { createSyncEngine } from './sync/sync-engine';
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
export const syncEngine = createSyncEngine({ store: dexieStore, api, connectivity });
export const newId = () => uuidv7();
