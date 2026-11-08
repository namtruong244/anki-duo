import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { api } from '../../client/api';
import { useAuth } from '../../client/auth-context';
import { authClient } from '../../client/auth';
import { performSignOut } from '../../client/sign-out';
import { notify } from '../../client/notify';
import { dexieStore } from '../../client/store';
import { saveSettings } from '../../client/settings-save';
import type { Settings } from '../../client/local-store';
import { ChunkyButton, Dialog, Icon } from '../../components/ui';
import { useSignOut } from '../use-sign-out';
import { useColorScheme } from '../../client/theme';

const GOALS = [10, 20, 30, 50] as const;

/** Big toggle button used by theme and language: selected = nav tint + nav border + blue lip. */
const toggleBtn = (active: boolean) =>
  `flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 px-4 text-sm font-extrabold uppercase tracking-wider transition-colors focus-visible:outline-3 focus-visible:outline-focus ${
    active
      ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text shadow-[0_4px_0_var(--color-nav-active-border)]'
      : 'border-border bg-card text-text-muted shadow-[0_4px_0_var(--color-border)] hover:bg-surface'
  }`;

function SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-xs font-black uppercase tracking-[0.12em] text-text-muted">
      {children}
    </h2>
  );
}

/** Settings (frames "Cài đặt" / "Mobile settings"): theme, daily goal, FSRS values, language; then quiet extras. */
export function SettingsPage() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [scheme, setScheme] = useColorScheme();
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      setSettings((await dexieStore.getSettings(userId)) ?? null);
    })();
  }, []);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  /** Applies a change at once, then saves it to the account; a failed save is reported. */
  async function save(patch: Partial<Settings>) {
    setSettings((cur) => (cur ? { ...cur, ...patch } : cur));
    const { settings: saved, synced } = await saveSettings(patch);
    if (saved) setSettings(saved);
    if (!synced) notify.show(t('learning.saveFailed'));
  }

  // With "follow system" on, show the theme that is actually in effect.
  const shown = scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme;

  return (
    <section className="flex flex-col gap-5 py-4">
      <h1 className="text-3xl font-black tracking-tight text-text">{t('nav.settings')}</h1>

      {settings && (
        <>
          {/* GIAO DIỆN */}
          <div className="flex flex-col gap-3">
            <SectionLabel>{t('ui.settings.appearance')}</SectionLabel>
            <div role="group" aria-label={t('ui.theme.title')} className="flex gap-4">
              {(['light', 'dark'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={shown === opt}
                  onClick={() => setScheme(opt)}
                  className={toggleBtn(shown === opt)}
                >
                  <Icon name={opt === 'light' ? 'sun' : 'moon'} size={20} />
                  <span>{t(`ui.theme.${opt}`)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* MỤC TIÊU XP MỖI NGÀY */}
          <div className="flex flex-col gap-3">
            <SectionLabel>{t('ui.settings.dailyGoal')}</SectionLabel>
            <div
              role="radiogroup"
              aria-label={t('gamification.dailyGoal')}
              className="grid grid-cols-4 gap-2.5 sm:gap-3"
            >
              {GOALS.map((g) => {
                const active = settings.dailyXpGoal === g;
                return (
                  <label
                    key={g}
                    className={`relative flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border-2 px-1 text-sm font-extrabold transition-colors focus-within:outline-3 focus-within:outline-focus ${
                      active
                        ? 'border-gold bg-gold text-on-gold shadow-[0_4px_0_var(--color-gold-depth)]'
                        : 'border-border bg-card text-text shadow-[0_4px_0_var(--color-border)] hover:bg-surface'
                    }`}
                  >
                    <input
                      type="radio"
                      name="dailyGoal"
                      value={String(g)}
                      aria-label={String(g)}
                      checked={active}
                      onChange={() => void save({ dailyXpGoal: g })}
                      className="sr-only"
                    />
                    <Icon
                      name="zap"
                      size={18}
                      className={`hidden sm:block ${active ? 'text-on-gold' : 'text-gold'}`}
                    />
                    <span className="tabular-nums">{g} XP</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* THÔNG SỐ FSRS */}
          <div className="flex flex-col gap-3">
            <SectionLabel id="fsrs-title">{t('ui.settings.fsrsParams')}</SectionLabel>
            <ul
              aria-labelledby="fsrs-title"
              className="overflow-hidden rounded-2xl border-2 border-border bg-card"
            >
              <FsrsRow
                label={t('ui.settings.retention')}
                display={`${Math.round(settings.desiredRetention * 100)}%`}
                value={Math.round(settings.desiredRetention * 100)}
                min={70}
                max={97}
                onCommit={(n) => save({ desiredRetention: n / 100 })}
              />
              <FsrsRow
                label={t('ui.settings.maxInterval')}
                display={t('ui.settings.valueDays', { n: settings.maximumIntervalDays })}
                value={settings.maximumIntervalDays}
                min={1}
                max={36500}
                onCommit={(n) => save({ maximumIntervalDays: n })}
              />
              <FsrsRow
                label={t('ui.settings.sessionSize')}
                display={t('ui.settings.valueCards', { n: settings.sessionSize })}
                value={settings.sessionSize}
                min={5}
                max={50}
                onCommit={(n) => save({ sessionSize: n })}
              />
              <FsrsRow
                label={t('ui.settings.dayStart')}
                display={`${String(settings.dayStartHour).padStart(2, '0')}:00`}
                value={settings.dayStartHour}
                min={0}
                max={23}
                onCommit={(n) => save({ dayStartHour: n })}
              />
            </ul>
            <p className="text-xs font-bold text-text-muted">{t('learning.futureOnly')}</p>
          </div>

          {/* NGÔN NGỮ */}
          <div className="flex flex-col gap-3">
            <SectionLabel>{t('ui.settings.language')}</SectionLabel>
            <div role="group" aria-label={t('language.label')} className="flex gap-3">
              {(['vi', 'en'] as const).map((loc) => (
                <button
                  key={loc}
                  type="button"
                  aria-pressed={settings.locale === loc}
                  onClick={() => void save({ locale: loc })}
                  className={toggleBtn(settings.locale === loc)}
                >
                  {t(`language.${loc}`)}
                </button>
              ))}
            </div>
          </div>

          {/* KHÁC: sound, motion and system theme */}
          <div className="mt-2 flex flex-col gap-3 border-t-2 border-border pt-5">
            <SectionLabel>{t('ui.settings.otherTitle')}</SectionLabel>
            <div className="flex flex-col gap-3">
              <SwitchRow
                label={t('ui.settings.themeSystem')}
                checked={scheme === 'system'}
                onToggle={() => setScheme(scheme === 'system' ? shown : 'system')}
              />
              <SwitchRow
                label={t('gamification.sound')}
                checked={settings.soundEnabled}
                onToggle={() => void save({ soundEnabled: !settings.soundEnabled })}
              />
              <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border-2 border-border bg-card px-4 text-sm font-extrabold text-text">
                <span>{t('gamification.motion')}</span>
                <select
                  value={settings.motion}
                  onChange={(e) => void save({ motion: e.target.value as Settings['motion'] })}
                  className="min-h-9 rounded-lg border-2 border-border bg-surface px-2 font-bold text-text focus:border-secondary focus:outline-none"
                >
                  <option value="system">{t('gamification.motionSystem')}</option>
                  <option value="reduced">{t('gamification.motionReduced')}</option>
                  <option value="full">{t('gamification.motionFull')}</option>
                </select>
              </label>
            </div>
          </div>

          {/* TÀI KHOẢN */}
          <div className="flex flex-col gap-3">
            <SectionLabel>{t('account.title')}</SectionLabel>
            <div className="flex flex-wrap gap-3">
              <ChunkyButton variant="neutral" onClick={signOut}>
                {t('auth.signOut')}
              </ChunkyButton>
              <DeleteAccount />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SwitchRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border-2 border-border bg-card px-4 text-sm font-extrabold text-text transition-colors hover:bg-surface focus-visible:outline-3 focus-visible:outline-focus"
    >
      <span>{label}</span>
      <span
        className={`h-7 w-12 shrink-0 rounded-full p-0.5 ${checked ? 'bg-primary' : 'bg-track'}`}
      >
        <span
          className={`block h-6 w-6 transform rounded-full bg-white shadow-md transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  );
}

/**
 * One FSRS row: the value sits in a small blue pill; clicking it swaps in a number input.
 * Enter or leaving the field saves, Escape cancels, and out-of-range or non-integer values are rejected.
 */
function FsrsRow(props: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => Promise<void> | void;
}) {
  const { label, display, value, min, max, onCommit } = props;
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelled = useRef(false);

  function start() {
    cancelled.current = false;
    setDraft(String(value));
    setEditing(true);
  }

  function finish() {
    if (!editing) return;
    setEditing(false);
    if (cancelled.current) return;
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(n) || n < min || n > max) {
      notify.show(t('ui.settings.invalidValue', { min, max }));
      return;
    }
    if (n !== value) void onCommit(n);
  }

  return (
    <li className="flex min-h-16 items-center justify-between gap-3 border-b-2 border-border px-5 py-2 last:border-b-0">
      <span className="min-w-0 text-sm font-bold text-text">{label}</span>
      {editing ? (
        <input
          autoFocus
          type="number"
          inputMode="numeric"
          step={1}
          min={min}
          max={max}
          aria-label={label}
          title={`${min}–${max}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish();
            } else if (e.key === 'Escape') {
              cancelled.current = true;
              setEditing(false);
            }
          }}
          className="h-9 w-24 shrink-0 rounded-xl border-2 border-nav-active-border bg-surface px-3 text-right text-sm font-extrabold tabular-nums text-nav-active-text focus:outline-none"
        />
      ) : (
        <button
          type="button"
          aria-label={`${label}: ${display}`}
          title={`${min}–${max}`}
          onClick={start}
          className="min-h-9 shrink-0 cursor-pointer rounded-xl border-2 border-border bg-surface px-3 text-sm font-extrabold tabular-nums text-nav-active-text transition-colors hover:border-nav-active-border focus-visible:outline-3 focus-visible:outline-focus"
        >
          {display}
        </button>
      )}
    </li>
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
          <p className="text-sm font-medium text-text">{t('account.deleteIntro')}</p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-extrabold text-text">{t('auth.password')}</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="min-h-12 rounded-[var(--radius-button)] border-2 border-border bg-surface px-4 font-bold text-text focus:border-secondary focus:outline-none"
            />
          </label>
          {error && (
            <p
              role="alert"
              className="rounded-[var(--radius-button)] border-2 border-danger bg-danger-tint/60 p-3 text-sm font-bold text-text"
            >
              {error}
            </p>
          )}
          <div className="flex gap-2 pt-2">
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
        <p className="mb-4 text-sm font-medium text-text">{t('account.deleteConfirm')}</p>
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-[var(--radius-button)] border-2 border-danger bg-danger-tint/60 p-3 text-sm font-bold text-text"
          >
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
