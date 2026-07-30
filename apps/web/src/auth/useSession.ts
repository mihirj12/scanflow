import type { CurrentUser } from '@scanflow/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { login, logout, restoreSession } from '../api/client';

export type SessionState =
  | { status: 'loading'; user: null }
  | { status: 'signed-out'; user: null }
  | { status: 'signed-in'; user: CurrentUser };

/**
 * Session as server state, so the whole app reads it through one query key.
 *
 * On mount this attempts a refresh: the access token is gone after a reload but
 * the httpOnly cookie is not, so a returning user is signed in without typing a
 * password again.
 */
export function useSession(): SessionState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
} {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['session'],
    queryFn: async () => (await restoreSession())?.user ?? null,
    retry: false,
    staleTime: Infinity,
  });

  const signIn = useCallback(
    async (email: string, password: string) => {
      const session = await login({ email, password });
      queryClient.setQueryData(['session'], session.user);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await logout();
    queryClient.setQueryData(['session'], null);
    // Drop every cached patient and appointment with the session that fetched it.
    queryClient.clear();
  }, [queryClient]);

  const state: SessionState = query.isPending
    ? { status: 'loading', user: null }
    : query.data == null
      ? { status: 'signed-out', user: null }
      : { status: 'signed-in', user: query.data };

  return { ...state, signIn, signOut };
}
