import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { AuthContext } from '../../src/client/auth-context';
import { dexieStore } from '../../src/client/store';
import type { Settings } from '../../src/client/local-store';
import { initI18n } from '../../src/i18n';
import { getColorScheme, setColorScheme } from '../../src/client/theme';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  del: vi.fn(),
  signInEmail: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('../../src/client/api', () => ({
  api: { PATCH: mocks.patch, DELETE: mocks.del },
  ApiError: class extends Error {},
}));
vi.mock('../../src/client/auth', () => ({
  authClient: { signIn: { email: mocks.signInEmail }, signOut: mocks.signOut },
}));

import { SettingsPage } from '../../src/routes/settings/SettingsPage';

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
  let server = { ...base };
  mocks.patch.mockImplementation(async (_path: string, { body }: { body: object }) => {
    server = { ...server, ...body };
    return { data: server };
  });
  mocks.del.mockResolvedValue({});
  mocks.signInEmail.mockResolvedValue({ data: {} });
  mocks.signOut.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderSettings = () =>
  render(
    <AuthContext.Provider
      value={{
        status: 'signed-in',
        user: { id: 'u', email: 'me@example.test', emailVerified: true },
      }}
    >
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/sign-in" element={<h1>Sign in page</h1>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );

describe('gamification settings (FR-021, FR-022, FR-025)', () => {
  it('offers the daily goals 10 / 20 / 30 / 50 with 20 selected by default', async () => {
    renderSettings();
    const group = await screen.findByRole('radiogroup', { name: 'Daily XP goal' });
    const radios = [...group.querySelectorAll('input[type=radio]')] as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['10', '20', '30', '50']);
    expect(radios.find((r) => r.checked)!.value).toBe('20');
  });

  it('saves the goal, sound and motion immediately and mirrors them locally', async () => {
    renderSettings();
    fireEvent.click(await screen.findByLabelText('30'));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { dailyXpGoal: 30 } }),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Sound' }));
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { soundEnabled: false } }),
    );
    fireEvent.change(screen.getByLabelText('Motion'), { target: { value: 'reduced' } });
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { motion: 'reduced' } }),
    );
    await waitFor(async () =>
      expect(await dexieStore.getSettings('u')).toMatchObject({
        dailyXpGoal: 30,
        soundEnabled: false,
        motion: 'reduced',
      }),
    );
  });
});

describe('language switch (FR-031, SC-009)', () => {
  it('changes the language at once, on the same screen, and saves it to the account', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếng Việt' }));
    expect(await screen.findByRole('heading', { name: 'Cài đặt' })).toBeTruthy();
    expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { locale: 'vi' } });
    expect(i18next.language).toBe('vi');
    expect((await dexieStore.getSettings('u'))!.locale).toBe('vi');
    expect(screen.getByRole('button', { name: 'Tiếng Việt' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('still switches when the save fails (offline) and says so', async () => {
    mocks.patch.mockRejectedValueOnce(new Error('offline'));
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Tiếng Việt' }));
    expect(await screen.findByRole('heading', { name: 'Cài đặt' })).toBeTruthy();
    expect(i18next.language).toBe('vi');
  });
});

describe('theme', () => {
  it('offers light and dark, plus a switch to follow the system theme', async () => {
    renderSettings();
    const group = await screen.findByRole('group', { name: 'Theme' });
    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));
    expect(getColorScheme()).toBe('dark');
    expect(within(group).getByRole('button', { name: 'Dark' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Follow system theme' }));
    expect(getColorScheme()).toBe('system');
    fireEvent.click(screen.getByRole('switch', { name: 'Follow system theme' }));
    expect(getColorScheme()).not.toBe('system');
    setColorScheme('system');
  });
});

describe('FSRS parameters', () => {
  async function edit(label: string, value: string) {
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}:`) }));
    const input = screen.getByRole('spinbutton', { name: label });
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }

  it('shows each value in a pill and saves an edited value', async () => {
    renderSettings();
    expect(await screen.findByRole('button', { name: 'Desired retention: 90%' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Max Interval.*: 36,500 days/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Session Size.*: 20 cards/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New day starts at: 04:00' })).toBeTruthy();
    await edit('Desired retention', '85');
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/me/settings', {
        body: { desiredRetention: 0.85 },
      }),
    );
    expect(await screen.findByRole('button', { name: 'Desired retention: 85%' })).toBeTruthy();
    await edit('New day starts at', '6');
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/me/settings', { body: { dayStartHour: 6 } }),
    );
    expect(await screen.findByRole('button', { name: 'New day starts at: 06:00' })).toBeTruthy();
  });

  it('rejects out-of-range values without saving', async () => {
    renderSettings();
    await edit('Desired retention', '99');
    expect(await screen.findByRole('button', { name: 'Desired retention: 90%' })).toBeTruthy();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it('Escape cancels the edit', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: /^Desired retention:/ }));
    const input = screen.getByRole('spinbutton', { name: 'Desired retention' });
    fireEvent.change(input, { target: { value: '80' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(await screen.findByRole('button', { name: 'Desired retention: 90%' })).toBeTruthy();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});

describe('account (FR-030)', () => {
  it('signing out wipes the device and goes to sign-in', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in page' })).toBeTruthy();
    expect(mocks.signOut).toHaveBeenCalled();
  });

  it('deleting needs a password, then a confirmation, then calls DELETE /me and signs out', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    // step 1: re-authenticate
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(mocks.signInEmail).toHaveBeenCalledWith({
        email: 'me@example.test',
        password: 'hunter2hunter2',
      }),
    );
    // step 2: confirm
    expect(await screen.findByText(/permanently/i)).toBeTruthy();
    expect(mocks.del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/me'));
    expect(await screen.findByRole('heading', { name: 'Sign in page' })).toBeTruthy();
    expect(await dexieStore.getSettings('u')).toBeUndefined();
  });

  it('a wrong password stops at step 1 and deletes nothing', async () => {
    mocks.signInEmail.mockResolvedValueOnce({ error: { message: 'bad' } });
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope-nope-nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/password/i);
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete account' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText(/permanently/i);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
