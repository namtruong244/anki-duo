import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { initI18n } from '../../src/i18n';

const mocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  social: vi.fn(),
  sendVerificationEmail: vi.fn(),
  verifyEmail: vi.fn(),
}));
vi.mock('../../src/client/auth', () => ({
  authClient: {
    signIn: { email: mocks.signInEmail, social: mocks.social },
    signUp: { email: mocks.signUpEmail },
    sendVerificationEmail: mocks.sendVerificationEmail,
    verifyEmail: mocks.verifyEmail,
  },
}));

import { SignInPage } from '../../src/routes/auth/SignInPage';
import { SignUpPage } from '../../src/routes/auth/SignUpPage';
import { VerifyEmailPage } from '../../src/routes/auth/VerifyEmailPage';

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  mocks.signInEmail.mockResolvedValue({ error: null });
  mocks.signUpEmail.mockResolvedValue({ error: null });
  mocks.sendVerificationEmail.mockResolvedValue({ error: null });
  mocks.verifyEmail.mockResolvedValue({ error: null });
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
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/" element={<h1>Home page</h1>} />
      </Routes>
    </MemoryRouter>,
  );

function fillSignIn() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

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
    fillSignIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/went wrong/i);
  });

  it('shows a wrong-password message with a forgot-password hint and keeps the email', async () => {
    mocks.signInEmail.mockResolvedValue({
      error: { code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 },
    });
    renderAt('/sign-in');
    fillSignIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/incorrect email or password/i);
    expect(screen.getAllByRole('link', { name: 'Forgot your password?' })).toHaveLength(1);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('a@b.test');
  });

  it('explains an unverified email and resends the verification link', async () => {
    mocks.signInEmail.mockResolvedValue({ error: { code: 'EMAIL_NOT_VERIFIED', status: 403 } });
    renderAt('/sign-in');
    fillSignIn();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/isn't verified yet/i);
    expect(alert.textContent).toMatch(/spam/i);
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() =>
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'a@b.test',
        callbackURL: '/',
      }),
    );
    expect(await screen.findByText(/Verification email sent to a@b.test/)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /Resend in \d+s/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows a network error when the request throws', async () => {
    mocks.signInEmail.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAt('/sign-in');
    fillSignIn();
    expect((await screen.findByRole('alert')).textContent).toMatch(/can't reach the server/i);
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
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password12' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.signUpEmail).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Verify your email' })).toBeTruthy();
  });

  it('blocks passwords shorter than 10 characters and shows the hint', async () => {
    renderAt('/sign-up');
    expect(screen.getByText('At least 10 characters')).toBeTruthy();
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.minLength).toBe(10);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(pw, { target: { value: '123456789' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.submit(pw.closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 10 characters/i);
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it('tells the user the account already exists and links to sign-in and reset', async () => {
    mocks.signUpEmail.mockResolvedValue({ error: { code: 'USER_ALREADY_EXISTS', status: 422 } });
    renderAt('/sign-up');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password12' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/already exists/i);
    const links = Array.from(alert.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/sign-in', '/reset-password']);
  });
});

describe('verify email page', () => {
  it('resends the email for the address in the query and reports success', async () => {
    renderAt('/verify-email?email=a%40b.test');
    expect(screen.getByText(/spam folder/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() =>
      expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'a@b.test',
        callbackURL: '/',
      }),
    );
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('offers resend in the failed state, asks for an email and reports failures', async () => {
    mocks.verifyEmail.mockResolvedValue({ error: { code: 'INVALID_TOKEN', status: 400 } });
    mocks.sendVerificationEmail.mockResolvedValue({ error: { status: 429 } });
    renderAt('/verify-email?token=bad');
    expect(await screen.findByText(/invalid or expired/i)).toBeTruthy();
    const btn = screen.getByRole('button', {
      name: 'Resend verification email',
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Your email'), { target: { value: 'x@y.test' } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(await screen.findByText(/too many attempts/i)).toBeTruthy();
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'x@y.test',
      callbackURL: '/',
    });
  });
});
