import { useEffect, useState } from 'react';
import type { PlayerProfile } from '../types/profile';

/**
 * Phase 12C — profile fetching.
 * - no playerId → the CALLER's profile via /api/me/profile (session or guest)
 * - playerId    → PUBLIC read-only profile /api/players/:id/profile
 *
 * `profile === null` with status 'ready' means signed-out/no identity yet
 * (server answers 200 {profile:null}) — not an error.
 */
export function usePlayerProfile(playerId?: string) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const url = playerId
      ? `/api/players/${encodeURIComponent(playerId)}/profile`
      : '/api/me/profile';

    setProfile(null);
    setStatus('loading');

    fetch(url)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        return { okStatus: res.status, body };
      })
      .then(({ okStatus, body }) => {
        if (cancelled) return;
        if (okStatus === 404) {
          setStatus('missing');
          return;
        }
        if (!body || typeof body !== 'object') {
          setStatus('error');
          return;
        }
        // Both endpoints answer {profile: object | null}.
        setProfile((body.profile ?? null) as PlayerProfile | null);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  return { profile, status };
}
