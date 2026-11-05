import { useEffect, useState } from 'react';
import { notify } from './notify';
import { ensureIdentity, syncEngine } from './runtime';
import { dexieStore } from './store';
import type { SyncStatus } from './sync/sync-engine';

/** Starts the sync engine for the signed-in user and returns its status. */
export function useSyncRuntime(userId: string | undefined): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(syncEngine.status());
  useEffect(() => syncEngine.subscribe(setStatus), []);
  useEffect(() => {
    if (!userId || import.meta.env.MODE === 'test') return;
    let alive = true;
    void ensureIdentity(dexieStore, userId).then(() => {
      if (alive) void syncEngine.start();
    });
    return () => {
      alive = false;
      syncEngine.stop();
    };
  }, [userId]);
  return status;
}

/** Latest toast message from `notify` (null when none). */
export function useToastMessage(): [string | null, () => void] {
  const [msg, setMsg] = useState<string | null>(notify.current());
  useEffect(() => notify.subscribe(setMsg), []);
  return [msg, () => notify.clear()];
}
