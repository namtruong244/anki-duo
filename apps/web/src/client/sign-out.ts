import type { LocalStore } from './local-store';

export interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Signs out and wipes everything on the device: every local store and every cache, including the
 * precache. The wipe runs even if the network sign-out fails (shared-device privacy).
 */
export async function performSignOut(deps: {
  store: LocalStore;
  caches: CacheStorageLike | undefined;
  signOut: () => Promise<unknown>;
}): Promise<void> {
  try {
    await deps.signOut();
  } catch {
    // Offline: the server session expires on its own; local data must still go.
  }
  await deps.store.clearAll();
  if (deps.caches) {
    for (const name of await deps.caches.keys()) await deps.caches.delete(name);
  }
}
