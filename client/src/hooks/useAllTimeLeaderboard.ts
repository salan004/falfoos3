import { useEffect, useState } from 'react';
import { AllTimeLeaderRow } from '../types/profile';

/**
 * Phase 13 — all-time leaderboard polling hook.
 * Fetches on activation/game change, then every 30s while active. REST only:
 * no socket involvement; aborts cleanly on unmount/param change.
 */
export function useAllTimeLeaderboard(active: boolean, gameId: string | null) {
  const [rows, setRows] = useState<AllTimeLeaderRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (gameId) params.set('gameId', gameId);
        const res = await fetch(`/api/leaderboard/all-time?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('badStatus');
        const data = (await res.json()) as { entries?: AllTimeLeaderRow[] };
        if (!cancelled) {
          setRows(data.entries ?? []);
          setHasError(false);
        }
      } catch (err) {
        if (!cancelled && (err as Error).name !== 'AbortError') setHasError(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    const timer = window.setInterval(load, 30000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active, gameId]);

  return { rows, isLoading, hasError };
}
