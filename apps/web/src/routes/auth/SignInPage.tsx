import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { authErrorMessage, classifyAuthError } from '../../client/auth-errors';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field, FormError, SocialSignIn } from './Shell';
import { useResendVerification } from './useResendVerification';

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const resend = useResendVerification();
  const kind = error ? classifyAuthError(error).kind : null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    let err: unknown;
    try {
      ({ error: err } = await authClient.signIn.email({
        email: String(f.get('email')),
        password: String(f.get('password')),
      }));
    } catch (ex) {
      err = ex;
    }
    setBusy(false);
    if (err) setError(err);
    else navigate('/');
  }

  return (
    <AuthShell title={t('auth.signIn')} variant="signin">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field
          label={t('auth.email')}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error !== null && (
          <FormError>
            <span className="block">{authErrorMessage(error, t)}</span>
            {kind === 'emailNotVerified' && (
              <span className="mt-1 block font-semibold text-text-muted">
                {t('auth.unverifiedHelp')}
              </span>
            )}
            {kind === 'invalidCredentials' && (
              <Link className="mt-1 block underline" to="/reset-password">
                {t('auth.invalidCredentialsHint')}
              </Link>
            )}
          </FormError>
        )}
        {kind === 'emailNotVerified' && (
          <div className="flex flex-col gap-2">
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
              <p role="status" className="text-sm font-bold text-primary-accent">
                {t('auth.resendSent', { email })}
              </p>
            )}
            {resend.status === 'failed' && (
              <p role="alert" className="text-sm font-bold text-danger">
                {classifyAuthError(resend.error).kind === 'generic'
                  ? t('auth.resendFailed')
                  : authErrorMessage(resend.error, t)}
              </p>
            )}
          </div>
        )}
        <ChunkyButton type="submit" disabled={busy} className="w-full rounded-2xl">
          {t('auth.signIn')}
        </ChunkyButton>
      </form>

      <SocialSignIn />

      <p className="text-center text-xs font-bold text-text-muted">
        <Link className="hover:underline" to="/reset-password">
          {t('auth.forgotPassword')}
        </Link>
      </p>
      <p className="text-center text-[11px] font-semibold leading-relaxed text-text-subtle">
        {t('auth.legalSignIn')}
      </p>
    </AuthShell>
  );
}
