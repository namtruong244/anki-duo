import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { authClient } from '../../client/auth';
import { ChunkyButton } from '../../components/ui';
import { AuthShell, Field, FormError, SocialSignIn } from './Shell';

function getStrength(p: string): { score: number; label: 'Weak' | 'Fair' | 'Good' | 'Strong' } {
  if (!p) return { score: 0, label: 'Weak' };
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score++;
  const clamped = Math.max(1, Math.min(score, 4));
  const labels: ('Weak' | 'Fair' | 'Good' | 'Strong')[] = ['Weak', 'Fair', 'Good', 'Strong'];
  return { score: clamped, label: labels[clamped - 1]! };
}

export function SignUpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);

  const strength = getStrength(password);
  const strengthColors: Record<number, string> = {
    1: 'bg-danger',
    2: 'bg-orange',
    3: 'bg-gold',
    4: 'bg-primary',
  };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!terms) {
      setError(t('auth.termsRequired'));
      return;
    }
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email'));
    setBusy(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      email,
      password: String(f.get('password')),
      name: String(f.get('name') || email),
      fetchOptions: {
        headers: { 'x-time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone },
      },
    });
    setBusy(false);
    if (err) setError(t('auth.error'));
    else navigate(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <AuthShell title={t('ui.auth.signUpTitle')} variant="signup">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label={t('auth.name')} name="name" autoComplete="name" />
        <Field label={t('auth.email')} name="email" type="email" autoComplete="email" required />
        <div className="flex flex-col gap-2">
          <Field
            label={t('auth.password')}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {password.length > 0 && (
            <div className="flex flex-col gap-1.5 px-0.5">
              <div className="grid h-1.5 w-full grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((bar) => (
                  <div
                    key={bar}
                    className={`h-full rounded-full transition-colors ${
                      bar <= strength.score ? strengthColors[strength.score] : 'bg-track'
                    }`}
                  />
                ))}
              </div>
              <div className="flex items-center justify-between text-xs font-bold text-text-muted">
                <span>{t('auth.password')}</span>
                <span className="font-extrabold text-text">
                  {t(`ui.auth.strength${strength.label}`)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Terms of service checkbox (required, as designed) */}
        <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-2xl border-2 border-border bg-surface p-3 text-xs font-semibold leading-relaxed text-text-muted transition-colors focus-within:border-secondary">
          <input
            type="checkbox"
            name="terms"
            checked={terms}
            onChange={(e) => {
              setTerms(e.target.checked);
              if (e.target.checked) setError(null);
            }}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-2 border-border accent-primary"
          />
          <span>{t('auth.legalSignUp')}</span>
        </label>

        {error && <FormError>{error}</FormError>}

        <ChunkyButton type="submit" disabled={busy || !terms} className="w-full rounded-2xl">
          {t('auth.signUp')}
        </ChunkyButton>
      </form>

      <SocialSignIn />
    </AuthShell>
  );
}
