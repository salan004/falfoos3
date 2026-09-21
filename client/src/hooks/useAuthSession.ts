import { apiFetch } from '../utils/api';
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
 *
 * F8-FIX — the shared session cache is now REACTIVE across every mounted
 * consumer. `markClaimed()` / `logout()` update the module cache and notify all
 * live `useAuthSession()` instances (e.g. the Header's AuthWidget), so the
 * linked state propagates immediately without a full page reload. The server
 * remains the source of truth; this only mirrors its already-confirmed state.
 */
let cachedUser: AuthUser | null | undefined;
let cachedGuestLinked = false;

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

function notifySessionListeners(): void {
  for (const listener of [...sessionListeners]) {
    try {
      listener();
    } catch {
      // A faulty consumer must never break the shared session update.
    }
  }
}

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null | undefined>(cachedUser);
  const [guestLinked, setGuestLinked] = useState(cachedGuestLinked);

  // Mirror every shared-cache change into this consumer's local state.
  useEffect(() => {
    const sync = () => {
      setUser(cachedUser);
      setGuestLinked(cachedGuestLinked);
    };
    sessionListeners.add(sync);
    return () => {
      sessionListeners.delete(sync);
    };
  }, []);

  useEffect(() => {
    if (cachedUser !== undefined) return;
    let alive = true;
    apiFetch('/api/auth/me')
      .then((r) => r.json())
      .then((data: { user: AuthUser | null; guestLinked?: boolean }) => {
        cachedUser = data.user ?? null;
        cachedGuestLinked = !!data.guestLinked;
        if (alive) {
          setUser(cachedUser);
          setGuestLinked(cachedGuestLinked);
        }
        notifySessionListeners();
      })
      .catch(() => {
        cachedUser = null;
        if (alive) setUser(null);
        notifySessionListeners();
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even on network failure the cookie is the only state — clear locally.
    }
    cachedUser = null;
    cachedGuestLinked = false;
    setUser(null);
    setGuestLinked(false);
    notifySessionListeners();
  }, []);

  const markClaimed = useCallback((): void => {
    cachedGuestLinked = true;
    setGuestLinked(true);
    notifySessionListeners();
  }, []);

  return { user, guestLinked, isLoading: user === undefined, logout, markClaimed };
}
