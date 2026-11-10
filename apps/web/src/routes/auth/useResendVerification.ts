import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from '../../client/auth';

export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendStatus = 'idle' | 'sent' | 'failed';

/** Resends the verification email, with a 60s cooldown between sends. */
export function useResendVerification() {
  const [status, setStatus] = useState<ResendStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const resend = useCallback(async (email: string) => {
    if (!email) return;
    setBusy(true);
    setStatus('idle');
    setError(null);
    let err: unknown;
    try {
      ({ error: err } = await authClient.sendVerificationEmail({ email, callbackURL: '/' }));
    } catch (e) {
      err = e;
    }
    setBusy(false);
    if (err) {
      setError(err);
      setStatus('failed');
      return;
    }
    setStatus('sent');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, []);

  return { resend, status, busy, cooldown, error };
}
