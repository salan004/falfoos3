import { apiFetch } from '../utils/api';
import { useEffect, useState } from 'react';

/**
 * Phase 11D/11E — stable guest identity trigger. The SERVER owns the
 * identity: this makes it set/refresh the httpOnly `falfoos_guest` cookie.
 * Phase 11E exports a memoized promise so the socket utility can guarantee
 * an identity exists BEFORE connecting (the server rejects otherwise).
 */
let identityPromise: Promise<void> | null = null;

export function ensureGuestIdentity(): Promise<void> {
  if (!identityPromise) {
    identityPromise = apiFetch('/api/guest/identity')
      .then(() => undefined)
      .catch(() => {
        // Allow a later retry — identity is progressive, never blocking UI.
        identityPromise = null;
        throw new Error('identity-unavailable');
      });
  }
  return identityPromise;
}

export function useGuestIdentity(): void {
  useEffect(() => {
    void ensureGuestIdentity().catch(() => undefined);
  }, []);
}

/** Current player's canonical ID (from /api/me/profile) */
let playerIdPromise: Promise<string | null> | null = null;

export function fetchPlayerId(): Promise<string | null> {
  if (!playerIdPromise) {
    playerIdPromise = apiFetch('/api/me/profile')
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => data?.profile?.player?.playerId ?? null)
      .catch(() => null);
  }
  return playerIdPromise;
}

export function usePlayerId(): string | null {
  const [playerId, setPlayerId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchPlayerId().then((id) => {
      if (!cancelled) setPlayerId(id);
    });
    return () => { cancelled = true; };
  }, []);
  return playerId;
}
