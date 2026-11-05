import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../client/api';
import { notify } from '../../client/notify';
import { dexieStore } from '../../client/store';
import type { Settings } from '../../client/local-store';
import { ChunkyButton } from '../../components/ui';
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
      <ChunkyButton variant="danger" onClick={signOut}>
        {t('auth.signOut')}
      </ChunkyButton>
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
