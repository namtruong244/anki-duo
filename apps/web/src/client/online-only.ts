import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { connectivity as appConnectivity, type Connectivity } from './connectivity';

/**
 * Creating, editing, deleting and importing need the server (FR-017). Wrap those actions with
 * this hook: they are disabled offline and a "needs connection" message explains why. Reviewing
 * never uses it.
 */
export function useOnlineOnly(connectivity: Connectivity = appConnectivity) {
  const { t } = useTranslation();
  const online = useSyncExternalStore(
    (cb) => connectivity.subscribe(cb),
    () => connectivity.isOnline(),
    () => true,
  );
  const message = online ? null : t('offline.needsConnection');
  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => unknown) =>
      (...args: A) => {
        if (connectivity.isOnline()) fn(...args);
      },
    [connectivity],
  );
  return {
    online,
    message,
    guard,
    /** Spread onto a button or input. */
    buttonProps: { disabled: !online, ...(message ? { title: message } : {}) } as {
      disabled: boolean;
      title?: string;
    },
  };
}
