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
  type RecreationalProfilePayload,
} from '../db/stats';
import { computeLevel } from '../utils/levels';
import { getEarnedAchievements, evaluateAchievements } from '../achievements/catalog';
import { getCompetitiveProgressionDto } from '../competitive/GlobalProgressionService';

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

/**
 * guests.player_id is stored in several legitimate forms: UUID v4, `user:<uuid>`
 * (socketIdentity), and YouTube channel IDs (`UC...`) that legacy guest rows
 * were keyed by. Accept the same compatible id space as the competitive routes;
 * resolution remains exact (and still 404s) via `getProfileIdentity`.
 */
const PLAYER_ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;

/**
 * Resolves the CALLER's canonical scoring id exactly like the socket
 * handshake does: session cookie → claimed guest row / user:<id> row;
 * otherwise the verified guest cookie. Null when neither exists.
 */
function resolveViewerPlayerId(req: Request): string | null {
  const user = resolveSession(req);
  if (user) {
    const claimed = ensureUserCanonicalPlayer(user);
    if (claimed) return claimed;
    // Phase 7 — incomplete account (signed in, no linked Player): fall back to
    // the verified guest identity. Never mint a `user:<id>` Player here.
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  return resolveVerifiedGuestId(cookies[GUEST_COOKIE]);
}

/**
 * Composes the full profile payload; null when the playerId is unknown.
 *
 * Phase 2.y — the payload now states data OWNERSHIP explicitly:
 *   `recreational` (Stream Games history) and `competitive` (reserved for
 *   Phase 2.z). The legacy top-level `totals`/`perGame`/`recentMatches`/
 *   `level`/`achievements` fields are RETAINED as recreational aliases so the
 *   current ProfilePage keeps working unchanged.
 *
 * Exported for focused separation tests.
 */
export function buildProfile(playerId: string, historyLimit = 10): PlayerProfilePayload | null {
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
  // RECREATIONAL level: derived from Stream Game points only. Phase 2.z will
  // add the competitive level under `competitive`; this one stays recreational.
  const level = computeLevel(totals.totalPoints);
  const achievements = getEarnedAchievements(playerId);

  const recreational: RecreationalProfilePayload = {
    source: 'stream_games',
    totals,
    perGame,
    recentMatches: history.items,
    historyTotal: history.total,
    level,
    achievements,
  };

  // Phase 2.z — GLOBAL competitive progression (cross-game XP/level/matches/wins).
  const competitive = getCompetitiveProgressionDto(playerId);

  return {
    player,
    // Legacy recreational aliases (ProfilePage compatibility).
    totals,
    perGame,
    recentMatches: history.items,
    historyTotal: history.total,
    level,
    achievements,
    // Explicit ownership blocks.
    recreational,
    competitive: {
      source: 'competitive_tournaments',
      status: 'active',
      xp: competitive.xp,
      level: competitive.level,
      tier: competitive.tier,
      tierLabelAr: competitive.tierLabelAr,
      isMax: competitive.isMax,
      progress: competitive.progress,
      matches: competitive.matches,
      wins: competitive.wins,
    },
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
