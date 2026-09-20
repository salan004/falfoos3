import { useEffect, useState } from 'react';
import { fetchPlayerCompetitiveProfiles } from '../utils/competitiveApi';
import type { PlayerCompetitiveProfile } from '../types/competitive';

export type PlayerCompetitiveStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Phase 2 — server-authoritative per-game competitive profiles for a player.
 *
 * Requests the `allGames` projection so every ACTIVE game is represented, with
 * `unranked: true` for games the player has no profile in yet. LP/Elo/rank are
 * never computed here — the server remains the single source of truth.
 *
 * - no playerId (or `enabled=false`) → nothing is fetched (status 'idle')
 */
export function usePlayerCompetitive(playerId?: string, enabled = true) {
  const [profiles, setProfiles] = useState<PlayerCompetitiveProfile[]>([]);
  const [status, setStatus] = useState<PlayerCompetitiveStatus>('idle');

  useEffect(() => {
    if (!enabled || !playerId) {
      setProfiles([]);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    setProfiles([]);
    setStatus('loading');

    fetchPlayerCompetitiveProfiles(playerId, true)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.data) {
          setStatus('error');
          return;
        }
        setProfiles(result.data.profiles ?? []);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [playerId, enabled]);

  return { profiles, status };
}
