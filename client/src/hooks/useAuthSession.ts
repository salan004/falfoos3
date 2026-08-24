import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'user' | 'admin';
}

/**
 * Phase 11C client session state. One-shot lookup of /api/auth/me per page
 * load; guests get {user:null} and everything stays exactly as before.
 * Phase 11D adds the additive `guestLinked` flag + markClaimed() so the
 * claim UI can update without a reload.
 */
let cachedUser: AuthUser | null | undefined;
let cachedGuestLinked = false;

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null | undefined>(cachedUser);
  const [guestLinked, setGuestLinked] = useState(cachedGuestLinked);

  useEffect(() => {
    if (cachedUser !== undefined) return;
    let alive = true;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { user: AuthUser | null; guestLinked?: boolean }) => {
        cachedUser = data.user ?? null;
        cachedGuestLinked = !!data.guestLinked;
        if (alive) {
          setUser(cachedUser);
          setGuestLinked(cachedGuestLinked);
        }
      })
      .catch(() => {
        cachedUser = null;
        if (alive) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even on network failure the cookie is the only state — clear locally.
    }
    cachedUser = null;
    cachedGuestLinked = false;
    setUser(null);
    setGuestLinked(false);
  }, []);

  const markClaimed = useCallback((): void => {
    cachedGuestLinked = true;
    setGuestLinked(true);
  }, []);

  return { user, guestLinked, isLoading: user === undefined, logout, markClaimed };
}
