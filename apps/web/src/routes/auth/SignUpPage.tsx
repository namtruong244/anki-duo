import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field } from './Shell';

export function SignUpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email'));
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      email,
      password: String(f.get('password')),
      name: String(f.get('name') || email),
      // The server stores the learner's IANA zone from this header (T043).
      fetchOptions: {
        headers: { 'x-time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    });
    setBusy(false);
    if (err) setError(t('auth.error'));
    else navigate(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell title={t('auth.signUp')}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field label={t('auth.name')} name="name" autoComplete="name" />
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <ChunkyButton type="submit" disabled={busy}>
          {t('auth.signUp')}
        </ChunkyButton>
      </form>
      <ChunkyButton
        variant="neutral"
        onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: '/' })}
      >
        {t('auth.google')}
      </ChunkyButton>
      <p>
        {t('auth.haveAccount')}{' '}
        <Link className="underline" to="/sign-in">
          {t('auth.signIn')}
        </Link>
      </p>
    </AuthShell>
  );
}
