import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field, FormError, SocialSignIn } from './Shell';

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
    <AuthShell title={t('auth.signIn')} variant="signin">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required />
        <Field
          label={t('auth.password')}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && <FormError>{error}</FormError>}
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
