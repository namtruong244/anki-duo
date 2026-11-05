import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { dexieStore } from './store';
import { setLocale } from '../i18n';
import { setSoundEnabled } from './sound';

/** Applies the learner's saved language and sound choice app-wide, including after a pull. */
export function useSettingsEffects() {
  const settings = useLiveQuery(async () => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    return dexieStore.getSettings(userId);
  }, []);
  useEffect(() => {
    if (!settings) return;
    void setLocale(settings.locale);
    document.documentElement.lang = settings.locale;
    setSoundEnabled(settings.soundEnabled);
  }, [settings]);
}
