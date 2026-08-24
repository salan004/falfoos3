import { Router, type Request } from 'express';
import { resolveSession, parseCookieHeader } from '../auth/session';
import { GUEST_COOKIE, resolveVerifiedGuestId } from '../auth/guest';
import { ensureUserCanonicalPlayer } from '../auth/socketIdentity';
import {
  getProfileIdentity,
  getPlayerTotals,
  getPerGameStats,
  getMatchHistory,
  type PlayerProfilePayload,
} from '../db/stats';
import { computeLevel } from '../utils/levels';
import { getEarnedAchievements, evaluateAchievements } from '../achievements/catalog';

/**
 * Phase 12B — player profile & stats routes (original roadmap: Persistent
 * Player Experience). Pure READS over the additive history tables; nothing
 * here touches the runtime scoring path.
 *
 * - GET /me/profile            → the CALLER's profile (session or guest cookie)
 * - GET /players/:id/profile   → PUBLIC read-only profile for any valid
 *                                playerId (Phase 13 leaderboard will link here)
 */

export const playerRoutes = Router();

/** guests.player_id is either a bare UUID or `user:<uuid>` (socketIdentity). */
const PLAYER_ID_RE = /^(?:user:)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves the CALLER's canonical scoring id exactly like the socket
 * handshake does: session cookie → claimed guest row / user:<id> row;
 * otherwise the verified guest cookie. Null when neither exists.
 */
function resolveViewerPlayerId(req: Request): string | null {
  const user = resolveSession(req);
  if (user) return ensureUserCanonicalPlayer(user);
  const cookies = parseCookieHeader(req.headers.cookie);
  return resolveVerifiedGuestId(cookies[GUEST_COOKIE]);
}

/** Composes the full profile payload; null when the playerId is unknown. */
function buildProfile(playerId: string, historyLimit = 10): PlayerProfilePayload | null {
  const player = getProfileIdentity(playerId);
  if (!player) return null;

  // Lazy achievement sweep keeps the profile self-healing if an evaluation
  // was missed (e.g. server crash mid-match); PK makes this idempotent.
  try {
    evaluateAchievements(playerId);
  } catch {
    // Non-fatal by design — earned rows already stored are still served.
  }

  const totals = getPlayerTotals(playerId);
  const perGame = getPerGameStats(playerId);
  const history = getMatchHistory(playerId, historyLimit);

  return {
    player,
    totals,
    perGame,
    recentMatches: history.items,
    historyTotal: history.total,
    level: computeLevel(totals.totalPoints),
    achievements: getEarnedAchievements(playerId),
  };
}

playerRoutes.get('/me/profile', (req, res) => {
  const playerId = resolveViewerPlayerId(req);
  if (!playerId) {
    // No identity yet → not an error; the client treats this as signed-out.
    res.json({ profile: null });
    return;
  }
  res.json({ profile: buildProfile(playerId) });
});

playerRoutes.get('/players/:playerId/profile', (req, res) => {
  const raw = typeof req.params.playerId === 'string' ? req.params.playerId : '';
  if (!PLAYER_ID_RE.test(raw)) {
    res.status(400).json({ error: 'invalidPlayerId' });
    return;
  }
  // Normalize bare UUIDs to the canonical lowercase form; user:<uuid> keeps
  // its prefix (already lowercase-safe by regex).
  const normalized = /^[a-f0-9-]{36}$/i.test(raw) ? raw.toLowerCase() : raw;
  const profile = buildProfile(normalized);
  if (!profile) {
    res.status(404).json({ error: 'playerNotFound' });
    return;
  }
  res.json({ profile });
});
