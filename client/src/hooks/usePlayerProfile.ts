import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import { onCompetitiveEvent } from '../utils/socket';
import type { PlayerProfile } from '../types/profile';

/**
 * Phase 12C — profile fetching.
 * - no playerId → the CALLER's profile via /api/me/profile (session or guest)
 * - playerId    → PUBLIC read-only profile /api/players/:id/profile
 *
 * `profile === null` with status 'ready' means signed-out/no identity yet
 * (server answers 200 {profile:null}) — not an error.
 *
 * `reloadToken` is optional: changing it re-runs the fetch so a caller (e.g.
 * the account-linking panel once a Player is claimed) can refresh the profile
 * through the existing mechanism without a page reload.
 *
 * Phase F4-C — realtime freshness: the server publishes
 * `competitive_profile.updated` (playerId + gameId only) after a match result
 * or correction commits. We refetch the authoritative profile in response, so
 * XP / level / progress update without a manual reload. This is event-driven
 * (no polling) and the subscription is established once per identity/enabled
 * change, so it cannot loop.
 */
export function usePlayerProfile(playerId?: string, enabled = true, reloadToken: unknown = 0) {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  // Bumped by competitive events to force one authoritative refetch.
  const [eventNonce, setEventNonce] = useState(0);
  // The caller's own canonical player id, learned from the fetched profile, so
  // the own-profile view can ignore events that belong to other players.
  const ownPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    ownPlayerIdRef.current = profile?.player.playerId ?? null;
  }, [profile]);

  // Realtime invalidation — subscribe once per (identity, enabled) change.
  useEffect(() => {
    if (!enabled) return undefined;
    const off = onCompetitiveEvent((event) => {
      if (event.type !== 'competitive_profile.updated') return;
      const target = playerId ?? ownPlayerIdRef.current;
      // When the event names a player and we know our target, ignore others.
      if (target && event.playerId && event.playerId !== target) return;
      setEventNonce((n) => n + 1);
    });
    return off;
  }, [playerId, enabled]);

  useEffect(() => {
    // Gated callers (e.g. the site header) can mount this hook without fetching.
    if (!enabled) {
      setProfile(null);
      setStatus('loading');
      return;
    }

    let cancelled = false;
    const url = playerId
      ? `/api/players/${encodeURIComponent(playerId)}/profile`
      : '/api/me/profile';

    setProfile(null);
    setStatus('loading');

    apiFetch(url)
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
  }, [playerId, enabled, reloadToken, eventNonce]);

  return { profile, status };
}
