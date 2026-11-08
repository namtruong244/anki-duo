import { api } from './api';
import { setSoundEnabled } from './sound';
import { dexieStore } from './store';
import type { Settings } from './local-store';
import { setLocale } from '../i18n';

export interface SaveSettingsResult {
  /** The settings now stored on this device (server copy when the save went through). */
  settings: Settings | undefined;
  /** False when the account copy could not be updated (offline, server error). */
  synced: boolean;
}

/**
 * Applies a settings change locally at once (Dexie, locale, sound), then saves it to the
 * account with PATCH /me/settings and reconciles the local copy with the server's answer.
 * Never throws: a failed account save is reported through `synced: false`.
 */
export async function saveSettings(patch: Partial<Settings>): Promise<SaveSettingsResult> {
  const userId = (await dexieStore.getMeta('userId')) ?? '';
  const current = userId ? await dexieStore.getSettings(userId) : undefined;
  let settings = current ? { ...current, ...patch } : undefined;
  if (userId && settings) await dexieStore.putSettings(userId, settings);
  if (patch.locale) await setLocale(patch.locale);
  if (patch.soundEnabled !== undefined) setSoundEnabled(patch.soundEnabled);
  try {
    const { data } = await api.PATCH('/me/settings', { body: patch });
    if (data) {
      if (userId) await dexieStore.putSettings(userId, data);
      settings = data;
    }
    return { settings, synced: true };
  } catch {
    return { settings, synced: false };
  }
}
