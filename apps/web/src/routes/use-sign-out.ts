import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { authClient } from '../client/auth';
import { dexieStore } from '../client/store';
import { performSignOut } from '../client/sign-out';

export function useSignOut() {
  const navigate = useNavigate();
  return useCallback(async () => {
    await performSignOut({
      store: dexieStore,
      caches: typeof caches === 'undefined' ? undefined : caches,
      signOut: () => authClient.signOut(),
    });
    navigate('/sign-in');
  }, [navigate]);
}
