import { useCallback, useEffect, useState } from 'react';

/**
 * SEO Fix 1 — History API (path-based) router.
 *
 * Replaces the legacy hash router. `path` is `pathname + search`
 * (e.g. `/player/abc?gameId=x`) — the same string shape the previous hash
 * router produced, so every `match*` helper below keeps working unchanged.
 *
 * Legacy `#/...` URLs are migrated once on load with `history.replaceState`
 * (no extra history entry, no redirect loop), preserving the path and query.
 */

function normalize(rawPath: string): string {
  const path = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  return path === '/' ? '/' : path.replace(/\/+$/, '');
}

/**
 * Converts a legacy hash value (`#/x?y`) to its path (`/x?y`).
 * Returns null when there is no legacy hash route to migrate.
 */
export function legacyHashToPath(hash: string): string | null {
  if (!hash || !hash.startsWith('#/')) return null;
  const raw = hash.slice(1); // drop the leading '#'
  return normalize(raw.startsWith('/') ? raw : '/' + raw);
}

function currentPath(): string {
  return normalize(window.location.pathname + window.location.search);
}

/** One-time migration of a legacy `#/...` URL; returns the resolved path. */
function resolveInitialPath(): string {
  const migrated = legacyHashToPath(window.location.hash);
  if (migrated) {
    window.history.replaceState(null, '', migrated);
    return migrated;
  }
  return currentPath();
}

export function useRoute() {
  const [path, setPath] = useState<string>(() => resolveInitialPath());

  useEffect(() => {
    const onPopState = () => setPath(currentPath());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    const next = normalize(to);
    if (currentPath() === next) return;
    window.history.pushState(null, '', next);
    setPath(next);
  }, []);

  return { path, navigate };
}

export function matchGameRoute(path: string): { gameId: string } | null {
  const m = path.match(/^\/game\/([a-z_]+)$/i);
  return m ? { gameId: m[1] } : null;
}

/**
 * Phase 12C — `/profile` (own profile) and `/profile/:playerId` (public,
 * read-only). The optional segment is a guests.player_id: a bare UUID or
 * `user:<uuid>` (hence the colon in the allowed characters).
 */
export function matchProfileRoute(path: string): { playerId?: string } | null {
  const m = path.match(/^\/profile(?:\/([A-Za-z0-9:_-]+))?$/i);
  return m ? { playerId: m[1] } : null;
}

/**
 * Phase 1D — dedicated competitive player statistics route.
 * `/player/<playerId>` with optional `?tournamentId=<id>&gameId=<id>` context
 * so the page can prefer the tournament's game and show tournament-specific
 * statistics. The general profile stays at `/profile/<playerId>`.
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
  // because Tournament Detail links to /stream-games/<gameId> with the raw id.
  const m = path.match(/^\/stream-games\/([A-Za-z0-9_-]+)$/);
  return m ? { gameId: m[1] } : null;
}

/**
 * Post-Phase 8 — dedicated FalFoos identity / registration experience
 * (`/register`). Reuses the existing Phase 8 account-linking flow; this route
 * is presentation only and adds no new registration path.
 */
export function matchRegisterRoute(path: string): boolean {
  return path === '/register';
}

/**
 * Broadcast Bracket (`/broadcast/:tournamentId`) — a transparent, interactive
 * presentation of the SAME tournament bracket for stream overlays. The id is
 * resolved through the existing public tournament APIs (no new data source).
 */
export function matchBroadcastRoute(path: string): { tournamentId: string } | null {
  const m = path.match(/^\/broadcast\/([a-z0-9-]+)$/i);
  return m ? { tournamentId: m[1] } : null;
}
