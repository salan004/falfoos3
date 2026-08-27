import { apiFetch } from '../utils/api';
import { useEffect } from 'react';

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
