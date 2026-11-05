import type { Api } from '../api';
import type { Connectivity } from '../connectivity';
import type { LocalStore } from '../local-store';
import { pullAll } from './pull';
import { pushOutbox } from './push';

export type SyncStatus = 'idle' | 'syncing' | 'error';

export const SYNC_INTERVAL_MS = 30_000;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

export interface SyncEngine {
  start(): Promise<void>;
  stop(): void;
  /** One push then one pull. Overlapping calls are coalesced. */
  syncNow(): Promise<void>;
  syncAfterSession(): Promise<void>;
  subscribe(fn: (status: SyncStatus) => void): () => void;
  status(): SyncStatus;
}

/**
 * Decides when to sync: at start, when the connection returns, every 30 s while the tab is
 * visible and online, and after a session. Network failures back off 1 s, 2 s, 4 s … up to 60 s.
 */
export function createSyncEngine(deps: {
  store: LocalStore;
  api: Pick<Api, 'POST' | 'GET'>;
  connectivity: Connectivity;
  isVisible?: () => boolean;
  onError?: (e: unknown) => void;
}): SyncEngine {
  const { store, api, connectivity } = deps;
  const isVisible =
    deps.isVisible ??
    (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let status: SyncStatus = 'idle';
  const listeners = new Set<(s: SyncStatus) => void>();
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let started = false;

  const set = (s: SyncStatus) => {
    if (s === status) return;
    status = s;
    listeners.forEach((l) => l(s));
  };

  async function run() {
    set('syncing');
    try {
      await pushOutbox(store, api);
      await pullAll(store, api);
      failures = 0;
      connectivity.reportSuccess();
      set('idle');
    } catch (e) {
      failures++;
      deps.onError?.(e);
      set('error');
      if ((e as { code?: string }).code === 'network_error') connectivity.reportFailure();
      if (started) {
        const delay = Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
        clearTimeout(retry);
        retry = setTimeout(() => void syncNow(), delay);
      }
    }
  }

  function syncNow(): Promise<void> {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await run();
      } while (again && started);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    async start() {
      started = true;
      unsubscribe = connectivity.subscribe((online) => {
        if (online) void syncNow();
      });
      interval = setInterval(() => {
        if (isVisible() && connectivity.isOnline()) void syncNow();
      }, SYNC_INTERVAL_MS);
      await syncNow();
    },
    stop() {
      started = false;
      clearTimeout(retry);
      clearInterval(interval);
      unsubscribe?.();
    },
    syncNow,
    syncAfterSession: syncNow,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    status: () => status,
  };
}
