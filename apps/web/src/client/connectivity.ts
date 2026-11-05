export interface Connectivity {
  isOnline(): boolean;
  subscribe(fn: (online: boolean) => void): () => void;
  /** Call after a request failed at the network level (a heuristic on top of `online`/`offline`). */
  reportFailure(): void;
  reportSuccess(): void;
}

export function createConnectivity(
  options: { target?: EventTarget; initial?: boolean } = {},
): Connectivity {
  const target = options.target ?? (typeof window !== 'undefined' ? window : new EventTarget());
  let online = options.initial ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  const listeners = new Set<(online: boolean) => void>();
  const set = (next: boolean) => {
    if (next === online) return;
    online = next;
    listeners.forEach((l) => l(online));
  };
  target.addEventListener('online', () => set(true));
  target.addEventListener('offline', () => set(false));
  return {
    isOnline: () => online,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reportFailure: () => set(false),
    reportSuccess: () => set(true),
  };
}

export const connectivity = createConnectivity();
