import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { useAuth } from '../../client/auth-context';
import { AuthShell } from './Shell';

/** Shows "check your inbox", or verifies when opened from the emailed link (`?token=`). */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'idle' | 'verifying' | 'ok' | 'failed'>(
    token ? 'verifying' : 'idle',
  );

  useEffect(() => {
    if (!token) return;
    void authClient
      .verifyEmail({ query: { token } })
      .then(({ error }) => setState(error ? 'failed' : 'ok'));
  }, [token]);

  const email = params.get('email') ?? user?.email ?? '';
  return (
    <AuthShell title={t('auth.verifyTitle')}>
      {state === 'idle' && <p>{t('auth.verifySent', { email })}</p>}
      {state === 'verifying' && <p role="status">{t('auth.verifying')}</p>}
      {state === 'ok' && <p role="status">{t('auth.verified')}</p>}
      {state === 'failed' && <p role="alert">{t('auth.verifyFailed')}</p>}
      <Link className="underline" to="/sign-in">
        {t('auth.signIn')}
      </Link>
    </AuthShell>
  );
}
