import { createContext, useContext } from 'react';
import type { SyncStatus } from './sync/sync-engine';

export const SyncStatusContext = createContext<SyncStatus>('idle');
export const useSyncStatus = () => useContext(SyncStatusContext);
