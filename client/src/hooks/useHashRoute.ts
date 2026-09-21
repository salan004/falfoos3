import { useCallback, useEffect, useState } from 'react';

function readPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  const path = raw.startsWith('/') ? raw : '/' + raw;
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}

export function useHashRoute() {
  const [path, setPath] = useState<string>(readPath);

  useEffect(() => {
    const onChange = () => setPath(readPath());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((to: string) => {
    const next = to.startsWith('/') ? to : '/' + to;
    if (readPath() === next) return;
    window.location.hash = '#' + next;
  }, []);

  return { path, navigate };
}

export function matchGameRoute(path: string): { gameId: string } | null {
  const m = path.match(/^\/game\/([a-z_]+)$/i);
  return m ? { gameId: m[1] } : null;
}

/**
 * Phase 12C — #/profile (own profile) and #/profile/:playerId (public,
 * read-only). The optional segment is a guests.player_id: a bare UUID or
 * `user:<uuid>` (hence the colon in the allowed characters).
 */
export function matchProfileRoute(path: string): { playerId?: string } | null {
  const m = path.match(/^\/profile(?:\/([A-Za-z0-9:_-]+))?$/i);
  return m ? { playerId: m[1] } : null;
}

/**
 * Phase 1D — dedicated competitive player statistics route.
 * `#/player/<playerId>` with optional `?tournamentId=<id>&gameId=<id>` context
 * so the page can prefer the tournament's game and show tournament-specific
 * statistics. The general profile stays at `#/profile/<playerId>`.
 */
export function matchPlayerRoute(
  path: string
): { playerId: string; tournamentId?: string; gameId?: string } | null {
  const m = path.match(/^\/player\/([A-Za-z0-9:_-]+)(?:\?(.*))?$/i);
  if (!m) return null;
  let playerId = m[1];
  try {
    playerId = decodeURIComponent(playerId);
  } catch {
    /* keep the raw segment when decoding fails */
  }
  const params = new URLSearchParams(m[2] ?? '');
  return {
    playerId,
    tournamentId: params.get('tournamentId') || undefined,
    gameId: params.get('gameId') || undefined,
  };
}

export function matchTournamentRoute(path: string): { tournamentId: string } | null {
  const m = path.match(/^\/tournaments\/([a-z0-9-]+)$/i);
  return m ? { tournamentId: m[1] } : null;
}

export function matchGameTournamentsRoute(path: string): { gameId: string } | null {
  const m = path.match(/^\/games\/([A-Za-z0-9-]+)$/i);
  return m ? { gameId: m[1] } : null;
}

export function matchAdminGamesRoute(path: string): boolean {
  return path === '/dashboard/games';
}

/**
 * Phase F1 — the live-session control panel moved off the Admin Control Center
 * landing route. Its behavior is unchanged; only the path moved.
 */
export function matchAdminLiveRoute(path: string): boolean {
  return path === '/dashboard/live';
}

/**
 * Phase F1 — tournament management, with an optional `?gameId=` filter so the
 * Games branch can deep-link into a single game's tournaments.
 */
export function matchAdminTournamentsRoute(path: string): { gameId?: string } | null {
  const m = path.match(/^\/dashboard\/tournaments(?:\?(.*))?$/);
  if (!m) return null;
  const params = new URLSearchParams(m[1] ?? '');
  return { gameId: params.get('gameId') || undefined };
}

export function matchStreamGamesRoute(path: string): { gameId: string } | null {
  // Accepts both catalog slugs (a-z_) and database game UUIDs (hex + hyphens),
  // because Tournament Detail links to #/stream-games/<gameId> with the raw id.
  const m = path.match(/^\/stream-games\/([A-Za-z0-9_-]+)$/);
  return m ? { gameId: m[1] } : null;
}

/**
 * Post-Phase 8 — dedicated FalFoos identity / registration experience
 * (`#/register`). Reuses the existing Phase 8 account-linking flow; this route
 * is presentation only and adds no new registration path.
 */
export function matchRegisterRoute(path: string): boolean {
  return path === '/register';
}

/**
 * Broadcast Bracket (`#/broadcast/:tournamentId`) — a transparent, interactive
 * presentation of the SAME tournament bracket for stream overlays. The id is
 * resolved through the existing public tournament APIs (no new data source).
 */
export function matchBroadcastRoute(path: string): { tournamentId: string } | null {
  const m = path.match(/^\/broadcast\/([a-z0-9-]+)$/i);
  return m ? { tournamentId: m[1] } : null;
}
