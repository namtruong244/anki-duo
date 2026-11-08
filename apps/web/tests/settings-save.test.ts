import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { dexieStore } from '../src/client/store';
import type { Settings } from '../src/client/local-store';
import { initI18n } from '../src/i18n';

const mocks = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('../src/client/api', () => ({ api: { PATCH: mocks.patch } }));

import { saveSettings } from '../src/client/settings-save';

const base: Settings = {
  locale: 'en',
  timeZone: 'UTC',
  dayStartHour: 4,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  dailyXpGoal: 20,
  sessionSize: 20,
  soundEnabled: true,
  motion: 'system',
};

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  await dexieStore.clearAll();
  await dexieStore.setMeta('userId', 'u');
  await dexieStore.putSettings('u', base);
});
afterEach(() => vi.clearAllMocks());

describe('saveSettings', () => {
  it('writes locally, PATCHes the account and keeps the server copy', async () => {
    mocks.patch.mockResolvedValue({ data: { ...base, dailyXpGoal: 30, sessionSize: 25 } });
    const res = await saveSettings({ dailyXpGoal: 30 });
    expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { dailyXpGoal: 30 } });
    expect(res.synced).toBe(true);
    expect(res.settings?.sessionSize).toBe(25);
    expect((await dexieStore.getSettings('u'))?.sessionSize).toBe(25);
  });

  it('applies a locale change to the UI and reports an offline save without throwing', async () => {
    mocks.patch.mockRejectedValue(new Error('offline'));
    const res = await saveSettings({ locale: 'vi' });
    expect(res.synced).toBe(false);
    expect(i18next.language).toBe('vi');
    expect((await dexieStore.getSettings('u'))?.locale).toBe('vi');
    expect(res.settings?.locale).toBe('vi');
  });
});
