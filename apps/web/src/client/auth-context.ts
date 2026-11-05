import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string | null;
}

export interface AuthState {
  status: 'loading' | 'signed-in' | 'signed-out';
  user: AuthUser | null;
}

export const AuthContext = createContext<AuthState>({ status: 'loading', user: null });
export const useAuth = () => useContext(AuthContext);
