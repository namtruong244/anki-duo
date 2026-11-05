import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field } from './Shell';

export function SignInPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signIn.email({
      email: String(f.get('email')),
      password: String(f.get('password')),
    });
    setBusy(false);
    if (err) setError(t('auth.error'));
    else navigate('/');
  }

  return (
    <AuthShell title={t('auth.signIn')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <ChunkyButton type="submit" disabled={busy}>
          {t('auth.signIn')}
        </ChunkyButton>
      </form>
      <ChunkyButton
        variant="neutral"
        onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}
      >
        {t('auth.google')}
      </ChunkyButton>
      <Link className="underline" to="/reset-password">
        {t('auth.forgotPassword')}
      </Link>
      <p>
        {t('auth.noAccount')}{' '}
        <Link className="underline" to="/sign-up">
          {t('auth.signUp')}
        </Link>
      </p>
    </AuthShell>
  );
}
