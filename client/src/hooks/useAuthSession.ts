import { apiFetch } from '../utils/api';
import { useCallback, useEffect, useState } from 'react';

export interface AuthUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'user' | 'admin';
}

/**
 * Resolved authentication state shared by every consumer.
 *
 * - `user === undefined` -> not yet known (initializing or temporarily unavailable)
 * - `user === null`      -> the server explicitly confirmed a guest
 * - `user` object        -> authenticated
 *
 * `error` is true when the last refresh could not be resolved (network / 5xx /
 * invalid response). It never downgrades a known user to guest.
 */
export interface AuthState {
  user: AuthUser | null | undefined;
  guestLinked: boolean;
  error: boolean;
}

/**
 * Phase 11C client session state, hardened Phase 1.
 *
 * Architecture is unchanged: a module-level singleton plus React hook
 * consumers (no Context/Redux/Zustand). The hardening adds:
 * - explicit HTTP status/body validation (never `r => r.json()` blindly);
 * - transient failures stay a retryable error, never a permanent guest;
 * - in-flight request deduplication (one `/api/auth/me` at a time);
 * - bounded exponential-backoff retry;
 * - an explicit `refreshAuthSession()`;
 * - logout-race protection via a generation token.
 */

let cachedUser: AuthUser | null | undefined;
let cachedGuestLinked = false;
let authError = false;

/** Incremented by logout / test reset to invalidate in-flight auth reads. */
let generation = 0;

/** The single shared in-flight refresh, if any. */
let inflight: Promise<AuthState> | null = null;

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

/** Current authenticated state snapshot (used by the hook and tests). */
export function getAuthState(): AuthState {
  return { user: cachedUser, guestLinked: cachedGuestLinked, error: authError };
}

function commit(user: AuthUser | null, guestLinked: boolean, error: boolean): AuthState {
  cachedUser = user;
  cachedGuestLinked = guestLinked;
  authError = error;
  notifySessionListeners();
  return getAuthState();
}

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayName === 'string' &&
    (candidate.role === 'user' || candidate.role === 'admin')
  );
}

type FetchOutcome =
  | { kind: 'ok'; user: AuthUser | null; guestLinked: boolean }
  | { kind: 'error' };

/**
 * One validated GET /api/auth/me. Any transport error, non-2xx status, invalid
 * JSON or malformed body is reported as `error` — never as a guest.
 */
async function fetchAuthState(): Promise<FetchOutcome> {
  let res: Response;
  try {
    // Auth state must never be served from an HTTP cache.
    res = await apiFetch('/api/auth/me', { cache: 'no-store' });
  } catch {
    return { kind: 'error' };
  }
  if (!res.ok) return { kind: 'error' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: 'error' };
  }
  if (!body || typeof body !== 'object' || !('user' in body)) {
    return { kind: 'error' };
  }

  const rawUser = (body as { user: unknown }).user;
  const guestLinked = !!(body as { guestLinked?: unknown }).guestLinked;

  if (rawUser === null) return { kind: 'ok', user: null, guestLinked };
  if (!isAuthUser(rawUser)) return { kind: 'error' };
  return { kind: 'ok', user: rawUser, guestLinked };
}

export interface RefreshAuthOptions {
  /** Additional attempts after the first (default 2). */
  retries?: number;
  /** Base backoff in ms (default 400; doubled per attempt). */
  delayMs?: number;
}

async function runRefresh(options?: RefreshAuthOptions): Promise<AuthState> {
  const retries = options?.retries ?? MAX_RETRIES;
  const delayMs = options?.delayMs ?? BASE_RETRY_DELAY_MS;
  const myGeneration = generation;

  for (let attempt = 0; ; attempt += 1) {
    const outcome = await fetchAuthState();

    // A logout (or reset) happened while this request was in flight: discard it.
    if (myGeneration !== generation) return getAuthState();

    if (outcome.kind === 'ok') {
      return commit(outcome.user, outcome.guestLinked, false);
    }

    if (attempt >= retries) {
      // Transient failure: keep the last known state and surface a retryable
      // error. A known authenticated user is never downgraded to guest here.
      authError = true;
      notifySessionListeners();
      return getAuthState();
    }

    await delay(delayMs * 2 ** attempt);
    if (myGeneration !== generation) return getAuthState();
  }
}

/**
 * Explicitly (re)read `/api/auth/me`. Concurrent callers share one request.
 * Bounded retry; never rejects.
 */
export function refreshAuthSession(options?: RefreshAuthOptions): Promise<AuthState> {
  if (inflight) return inflight;
  const promise = runRefresh(options);
  inflight = promise;
  void promise.finally(() => {
    if (inflight === promise) inflight = null;
  });
  return promise;
}

/** Only the initial load auto-initializes; later mounts reuse the cache. */
function needsInitialization(): boolean {
  return cachedUser === undefined && inflight === null;
}

/** Logs out locally and on the server; invalidates any in-flight auth read. */
export async function logoutAuthSession(): Promise<void> {
  generation += 1;
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // Even on network failure the cookie is the only state — clear locally.
  }
  commit(null, false, false);
}

/** Marks the current account as linked to a Player (additive, local mirror). */
export function markAuthClaimed(): void {
  cachedGuestLinked = true;
  notifySessionListeners();
}

/** Test-only: restore the module to its pristine pre-initialization state. */
export function __resetAuthSessionForTests(): void {
  generation += 1;
  cachedUser = undefined;
  cachedGuestLinked = false;
  authError = false;
  inflight = null;
}

export function useAuthSession() {
  const [user, setUser] = useState<AuthUser | null | undefined>(cachedUser);
  const [guestLinked, setGuestLinked] = useState(cachedGuestLinked);
  const [error, setError] = useState(authError);

  // Mirror every shared-cache change into this consumer's local state.
  useEffect(() => {
    const sync = () => {
      setUser(cachedUser);
      setGuestLinked(cachedGuestLinked);
      setError(authError);
    };
    sessionListeners.add(sync);
    // Trigger initialization exactly once (dedup makes concurrent mounts share
    // the same request). Later mounts reuse the resolved cache.
    if (needsInitialization()) {
      void refreshAuthSession();
    }
    return () => {
      sessionListeners.delete(sync);
    };
  }, []);

  const logout = useCallback((): Promise<void> => logoutAuthSession(), []);

  const markClaimed = useCallback((): void => {
    markAuthClaimed();
  }, []);

  const refresh = useCallback((): Promise<AuthState> => refreshAuthSession(), []);

  return {
    user,
    guestLinked,
    isLoading: user === undefined,
    error,
    logout,
    markClaimed,
    refresh,
  };
}
