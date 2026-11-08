import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/i18n';

const mocks = vi.hoisted(() => ({ signInEmail: vi.fn(), signUpEmail: vi.fn(), social: vi.fn() }));
vi.mock('../../src/client/auth', () => ({
  authClient: {
    signIn: { email: mocks.signInEmail, social: mocks.social },
    signUp: { email: mocks.signUpEmail },
  },
}));

import { SignInPage } from '../../src/routes/auth/SignInPage';
import { SignUpPage } from '../../src/routes/auth/SignUpPage';

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  mocks.signInEmail.mockResolvedValue({ error: null });
  mocks.signUpEmail.mockResolvedValue({ error: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="/sign-up" element={<SignUpPage />} />
        <Route path="/verify-email" element={<h1>Verify page</h1>} />
        <Route path="/" element={<h1>Home page</h1>} />
      </Routes>
    </MemoryRouter>,
  );

describe('sign-in', () => {
  it('has a sign-up link on top, a Google button and no Facebook', () => {
    renderAt('/sign-in');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/sign-up');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toBeTruthy();
    expect(screen.queryByText(/facebook/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    expect(mocks.social).toHaveBeenCalledWith({ provider: 'google', callbackURL: '/' });
  });

  it('signs in and goes home; shows an error when it fails', async () => {
    renderAt('/sign-in');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeTruthy();
    expect(mocks.signInEmail).toHaveBeenCalledWith({ email: 'a@b.test', password: 'password1' });
  });

  it('reports a failed sign-in', async () => {
    mocks.signInEmail.mockResolvedValue({ error: { message: 'bad' } });
    renderAt('/sign-in');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/went wrong/i);
  });
});

describe('sign-up', () => {
  it('needs the terms ticked, then creates the account and goes to verify', async () => {
    renderAt('/sign-up');
    expect(screen.getByRole('heading', { name: 'Create your profile' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/sign-in');
    const submit = screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.signUpEmail).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Verify page' })).toBeTruthy();
  });
});
