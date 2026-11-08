import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'color-scheme';
const listeners = new Set<() => void>();

function ensureMeta(): HTMLMetaElement | null {
  if (typeof document === 'undefined') return null;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light dark';
    document.head.appendChild(meta);
  }
  return meta;
}

export function getColorScheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // Ignore storage restrictions
  }
  return 'system';
}

export function setColorScheme(choice: ThemeChoice): void {
  const meta = ensureMeta();
  const content = choice === 'system' ? 'light dark' : choice;
  if (meta) meta.content = content;
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Still applied to meta even when storage is blocked
  }
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) {
      const meta = ensureMeta();
      const current = getColorScheme();
      if (meta) meta.content = current === 'system' ? 'light dark' : current;
      cb();
    }
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

export function useColorScheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore<ThemeChoice>(subscribe, getColorScheme, () => 'system');
  return [choice, setColorScheme];
}
