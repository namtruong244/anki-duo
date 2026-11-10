import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { useAuth } from '../../client/auth-context';
import { ChunkyButton } from '../../components/ui';
import { authErrorMessage } from '../../client/auth-errors';
import { AuthShell, Field } from './Shell';
import { useResendVerification } from './useResendVerification';

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

  const knownEmail = params.get('email') ?? user?.email ?? '';
  const [typedEmail, setTypedEmail] = useState('');
  const email = knownEmail || typedEmail;
  const resend = useResendVerification();
  return (
    <AuthShell title={t('auth.verifyTitle')} variant="verify">
      <div className="flex flex-col gap-4 text-center">
        {state === 'idle' && (
          <p className="text-base font-medium text-text">{t('auth.verifySent', { email })}</p>
        )}
        {state === 'verifying' && (
          <p
            role="status"
            className="rounded-2xl border-2 border-secondary bg-secondary-tint/60 p-4 text-base font-bold text-text"
          >
            {t('auth.verifying')}
          </p>
        )}
        {state === 'ok' && (
          <p
            role="status"
            className="rounded-2xl border-2 border-primary bg-primary-tint/70 p-4 text-base font-bold text-primary-accent"
          >
            {t('auth.verified')}
          </p>
        )}
        {state === 'failed' && (
          <p
            role="alert"
            className="rounded-2xl border-2 border-danger bg-danger-tint/70 p-4 text-base font-bold text-text"
          >
            {t('auth.verifyFailed')}
          </p>
        )}
        {state !== 'verifying' && state !== 'ok' && (
          <div className="flex flex-col gap-3 text-left">
            <p className="text-center text-sm font-semibold text-text-muted">
              {t('auth.checkSpam')}
            </p>
            {!knownEmail && (
              <Field
                label={t('auth.resendEmailLabel')}
                name="resend-email"
                type="email"
                autoComplete="email"
                value={typedEmail}
                onChange={(e) => setTypedEmail(e.target.value)}
              />
            )}
            <ChunkyButton
              type="button"
              variant="outline"
              className="w-full rounded-2xl"
              disabled={resend.busy || resend.cooldown > 0 || !email}
              onClick={() => void resend.resend(email)}
            >
              {resend.busy
                ? t('auth.resendSending')
                : resend.cooldown > 0
                  ? t('auth.resendCooldown', { seconds: resend.cooldown })
                  : t('auth.resend')}
            </ChunkyButton>
            {resend.status === 'sent' && (
              <p role="status" className="text-center text-sm font-bold text-primary-accent">
                {t('auth.resendSent', { email })}
              </p>
            )}
            {resend.status === 'failed' && (
              <p role="alert" className="text-center text-sm font-bold text-danger">
                {authErrorMessage(resend.error, t)}
              </p>
            )}
          </div>
        )}
        <div className="pt-2">
          <Link className="text-xs font-bold text-text-muted hover:underline" to="/sign-in">
            {t('auth.signIn')}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
