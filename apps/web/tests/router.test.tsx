import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthContext, type AuthState } from '../src/client/auth-context';
import { AppRoutes } from '../src/routes/router';
import { initI18n } from '../src/i18n';

afterEach(cleanup);
initI18n('en');

const renderAt = (path: string, auth: AuthState) =>
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

describe('router guard', () => {
  it('redirects a signed-out visitor from a protected route to sign-in', () => {
    renderAt('/decks', { status: 'signed-out', user: null });
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
  });

  it('redirects an unverified user to the verify page', () => {
    renderAt('/', { status: 'signed-in', user: { id: 'u', email: 'a@b.c', emailVerified: false } });
    expect(screen.getByRole('heading', { name: 'Verify your email' })).toBeTruthy();
  });

  it('shows the app shell for a verified user', () => {
    renderAt('/', { status: 'signed-in', user: { id: 'u', email: 'a@b.c', emailVerified: true } });
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  });

  it('sends a signed-in user away from sign-in', () => {
    renderAt('/sign-in', {
      status: 'signed-in',
      user: { id: 'u', email: 'a@b.c', emailVerified: true },
    });
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
  });

  it('shows a loading state while the session is resolving', () => {
    renderAt('/', { status: 'loading', user: null });
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
