import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field, FormError } from './Shell';

/** Requests a reset link, or sets a new password when opened with `?token=`. */
export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    if (token) {
      const { error: err } = await authClient.resetPassword({
        newPassword: String(f.get('password')),
        token,
      });
      if (err) setError(t('auth.error'));
      else setMessage(t('auth.resetDone'));
    } else {
      await authClient.requestPasswordReset({
        email: String(f.get('email')),
        redirectTo: '/reset-password',
      });
      setMessage(t('auth.resetSent'));
    }
  }

  return (
    <AuthShell title={t('auth.resetPassword')} variant="reset">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {token ? (
          <Field
            label={t('auth.newPassword')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        ) : (
          <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required />
        )}
        {error && <FormError>{error}</FormError>}
        {message && (
          <p
            role="status"
            className="rounded-2xl border-2 border-secondary bg-secondary-tint/60 p-3 text-sm font-bold text-text"
          >
            {message}
          </p>
        )}
        <ChunkyButton type="submit" className="w-full rounded-2xl">
          {token ? t('auth.resetPassword') : t('auth.sendResetLink')}
        </ChunkyButton>
      </form>
      <div className="text-center">
        <Link className="text-xs font-bold text-text-muted hover:underline" to="/sign-in">
          {t('auth.signIn')}
        </Link>
      </div>
    </AuthShell>
  );
}
