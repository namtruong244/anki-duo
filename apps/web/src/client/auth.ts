import { createElement, type ReactNode } from 'react';
import { createAuthClient } from 'better-auth/react';
import { AuthContext, type AuthState } from './auth-context';

export const authClient = createAuthClient({ basePath: '/api/auth' });

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = authClient.useSession();
  const state: AuthState = isPending
    ? { status: 'loading', user: null }
    : data?.user
      ? { status: 'signed-in', user: data.user }
      : { status: 'signed-out', user: null };
  return createElement(AuthContext.Provider, { value: state }, children);
}
