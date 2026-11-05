import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../client/api';
import { useAuth } from '../../client/auth-context';
import { authClient } from '../../client/auth';
import { performSignOut } from '../../client/sign-out';
import { setLocale } from '../../i18n';
import { setSoundEnabled } from '../../client/sound';
import { useNavigate } from 'react-router';
import { notify } from '../../client/notify';
import { dexieStore } from '../../client/store';
import type { Settings } from '../../client/local-store';
import { ChunkyButton, Dialog } from '../../components/ui';
import { useSignOut } from '../use-sign-out';

/** Learning section (FR-004): changes apply to future reviews only. */
export function SettingsPage() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      setSettings((await dexieStore.getSettings(userId)) ?? null);
    })();
  }, []);

  /** Applies a change locally at once, then saves it to the account; a failed save is reported. */
  async function save(patch: Partial<Settings>) {
    if (!settings) return;
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const next = { ...settings, ...patch };
    setSettings(next);
    await dexieStore.putSettings(userId, next);
    if (patch.locale) await setLocale(patch.locale);
    if (patch.soundEnabled !== undefined) setSoundEnabled(patch.soundEnabled);
    try {
      const { data } = await api.PATCH('/me/settings', { body: patch });
      if (data) await dexieStore.putSettings(userId, data);
    } catch {
      notify.show(t('learning.saveFailed'));
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch = {
      desiredRetention: Number(f.get('retention')) / 100,
      maximumIntervalDays: Number(f.get('maxInterval')),
      sessionSize: Number(f.get('sessionSize')),
      dayStartHour: Number(f.get('dayStart')),
    };
    setBusy(true);
    try {
      const { data } = await api.PATCH('/me/settings', { body: patch });
      if (data) {
        const userId = (await dexieStore.getMeta('userId')) ?? '';
        await dexieStore.putSettings(userId, data);
        setSettings(data);
      }
      notify.show(t('learning.saved'));
    } catch {
      notify.show(t('learning.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-6 py-4">
      <h1 className="text-2xl font-bold">{t('nav.settings')}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-labelledby="learning-title">
        <h2 id="learning-title" className="text-xl font-bold">
          {t('learning.title')}
        </h2>
        {settings && (
          <>
            <NumberField
              label={t('learning.retention')}
              hint={t('learning.retentionHint')}
              name="retention"
              min={70}
              max={97}
              defaultValue={Math.round(settings.desiredRetention * 100)}
            />
            <NumberField
              label={t('learning.maxInterval')}
              hint={t('learning.maxIntervalHint')}
              name="maxInterval"
              min={1}
              max={36500}
              defaultValue={settings.maximumIntervalDays}
            />
            <NumberField
              label={t('learning.sessionSize')}
              hint={t('learning.sessionSizeHint')}
              name="sessionSize"
              min={5}
              max={50}
              defaultValue={settings.sessionSize}
            />
            <NumberField
              label={t('learning.dayStart')}
              hint={t('learning.dayStartHint')}
              name="dayStart"
              min={0}
              max={23}
              defaultValue={settings.dayStartHour}
            />
            <p className="text-sm text-text-muted">{t('learning.futureOnly')}</p>
            <ChunkyButton type="submit" disabled={busy}>
              {t('learning.save')}
            </ChunkyButton>
          </>
        )}
      </form>
      {settings && (
        <>
          <section aria-labelledby="goals-title" className="flex flex-col gap-4">
            <h2 id="goals-title" className="text-xl font-bold">
              {t('gamification.title')}
            </h2>
            <fieldset>
              <div
                role="radiogroup"
                aria-label={t('gamification.dailyGoal')}
                className="flex flex-wrap gap-2"
              >
                {([10, 20, 30, 50] as const).map((g) => (
                  <label
                    key={g}
                    className="flex min-h-11 min-w-16 cursor-pointer items-center justify-center rounded-[var(--radius-button)] border border-border px-4 font-bold has-[:checked]:bg-primary has-[:checked]:text-on-primary has-[:focus-visible]:outline has-[:focus-visible]:outline-2"
                  >
                    <input
                      type="radio"
                      name="dailyGoal"
                      value={g}
                      checked={settings.dailyXpGoal === g}
                      onChange={() => void save({ dailyXpGoal: g })}
                      className="sr-only"
                    />
                    {g}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-sm text-text-muted">{t('gamification.dailyGoalHint')}</p>
            </fieldset>
            <button
              type="button"
              role="switch"
              aria-checked={settings.soundEnabled}
              aria-label={t('gamification.sound')}
              onClick={() => void save({ soundEnabled: !settings.soundEnabled })}
              className="flex min-h-11 items-center justify-between rounded-[var(--radius-button)] border border-border px-4 font-semibold"
            >
              <span aria-hidden="true">{t('gamification.sound')}</span>
              <span aria-hidden="true">{settings.soundEnabled ? '🔊' : '🔇'}</span>
            </button>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">{t('gamification.motion')}</span>
              <select
                value={settings.motion}
                onChange={(e) => void save({ motion: e.target.value as Settings['motion'] })}
                className="min-h-11 rounded-[var(--radius-button)] border border-border bg-bg px-3"
              >
                <option value="system">{t('gamification.motionSystem')}</option>
                <option value="reduced">{t('gamification.motionReduced')}</option>
                <option value="full">{t('gamification.motionFull')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">{t('language.label')}</span>
              <select
                value={settings.locale}
                onChange={(e) => void save({ locale: e.target.value as Settings['locale'] })}
                className="min-h-11 rounded-[var(--radius-button)] border border-border bg-bg px-3"
              >
                <option value="vi">{t('language.vi')}</option>
                <option value="en">{t('language.en')}</option>
              </select>
            </label>
          </section>
        </>
      )}
      <section aria-labelledby="account-title" className="flex flex-col gap-3">
        <h2 id="account-title" className="text-xl font-bold">
          {t('account.title')}
        </h2>
        <ChunkyButton variant="neutral" onClick={signOut}>
          {t('auth.signOut')}
        </ChunkyButton>
        <DeleteAccount />
      </section>
    </section>
  );
}

function NumberField(props: {
  label: string;
  hint: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
}) {
  const { label, hint, ...rest } = props;
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">{label}</span>
      <input
        type="number"
        required
        step={1}
        {...rest}
        aria-describedby={`${rest.name}-hint`}
        className="min-h-11 rounded-[var(--radius-button)] border border-border bg-bg px-3"
      />
      <span id={`${rest.name}-hint`} className="text-sm text-text-muted">
        {hint}
      </span>
    </label>
  );
}

/** Two steps (FR-030): prove it is you with the password, then confirm the irreversible delete. */
function DeleteAccount() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'closed' | 'password' | 'confirm'>('closed');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setStep('closed');
    setError(null);
  };

  async function reauth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password') ?? '');
    setBusy(true);
    setError(null);
    try {
      const res = await authClient.signIn.email({ email: user?.email ?? '', password });
      if (res?.error) setError(t('account.wrongPassword'));
      else setStep('confirm');
    } catch {
      setError(t('account.wrongPassword'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.DELETE('/me');
      await performSignOut({
        store: dexieStore,
        caches: typeof caches === 'undefined' ? undefined : caches,
        signOut: async () => undefined,
      });
      navigate('/sign-in');
    } catch {
      setError(t('account.deleteFailed'));
      setBusy(false);
    }
  }

  return (
    <>
      <ChunkyButton variant="danger" onClick={() => setStep('password')}>
        {t('account.delete')}
      </ChunkyButton>
      <Dialog open={step === 'password'} title={t('account.delete')} onClose={close}>
        <form onSubmit={reauth} className="flex flex-col gap-3">
          <p>{t('account.deleteIntro')}</p>
          <label className="flex flex-col gap-1">
            <span className="font-semibold">{t('auth.password')}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-11 rounded-[var(--radius-button)] border border-border bg-bg px-3"
            />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <ChunkyButton type="submit" disabled={busy}>
              {t('account.continue')}
            </ChunkyButton>
            <ChunkyButton variant="neutral" onClick={close}>
              {t('common.cancel')}
            </ChunkyButton>
          </div>
        </form>
      </Dialog>
      <Dialog open={step === 'confirm'} title={t('account.delete')} onClose={close}>
        <p className="mb-4">{t('account.deleteConfirm')}</p>
        {error && (
          <p role="alert" className="mb-2 text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <ChunkyButton variant="danger" onClick={remove} disabled={busy}>
            {t('account.deleteEverything')}
          </ChunkyButton>
          <ChunkyButton variant="neutral" onClick={close}>
            {t('common.cancel')}
          </ChunkyButton>
        </div>
      </Dialog>
    </>
  );
}
