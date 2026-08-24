import { getDb } from './db';
import { computeLevel, type LevelInfo } from '../utils/levels';

/**
 * Phase 12B — read-side aggregation over the additive Phase 11G/12A tables.
 *
 * Pure READS: nothing here ever writes or blocks gameplay. Queries are kept
 * deliberately small and merged in JS instead of one mega-join so that
 * participations and score_events can never double-count each other.
 *
 * This layer is designed to be reusable by the Phase 13 Advanced Leaderboard
 * (per-game filters, all-time totals) without reshaping the schema.
 */

export interface PlayerTotals {
  totalPoints: number;
  matchesPlayed: number;
  /** Full-match victories — the Profile "Wins" statistic. */
  matchWins: number;
  /** Round-scoped victories (per-game statistics only). */
  roundWins: number;
}

export interface PerGameStat {
  gameId: string;
  totalPoints: number;
  matchesPlayed: number;
  matchWins: number;
  roundWins: number;
}

export interface MatchHistoryItem {
  matchId: string;
  gameId: string;
  startedAt: number;
  endedAt: number | null;
  /** Points THIS player earned in that match. */
  pointsEarned: number;
  wonMatch: boolean;
  wonRound: boolean;
}

export interface ProfileIdentity {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  /** 'user' when the guest row is claimed by a registered account. */
  identityKind: 'guest' | 'user';
}

export interface AwardedAchievement {
  id: string;
  titleAr: string;
  descriptionAr: string;
  icon: string;
  awardedAt: number;
}

export interface PlayerProfilePayload {
  player: ProfileIdentity;
  totals: PlayerTotals;
  perGame: PerGameStat[];
  recentMatches: MatchHistoryItem[];
  historyTotal: number;
  level: LevelInfo;
  achievements: AwardedAchievement[];
}

interface StatsStatements {
  totalPoints: import('better-sqlite3').Statement;
  matchesPlayed: import('better-sqlite3').Statement;
  matchWins: import('better-sqlite3').Statement;
  roundWins: import('better-sqlite3').Statement;
  perGamePoints: import('better-sqlite3').Statement;
  perGamePlayed: import('better-sqlite3').Statement;
  perGameWins: import('better-sqlite3').Statement;
  historyPage: import('better-sqlite3').Statement;
  identity: import('better-sqlite3').Statement;
}

let statements: StatsStatements | null = null;

function stmts(): StatsStatements {
  if (!statements) {
    const db = getDb();
    statements = {
      totalPoints: db.prepare(
        'SELECT COALESCE(SUM(points), 0) AS p FROM score_events WHERE player_id = ?'
      ),
      matchesPlayed: db.prepare(
        'SELECT COUNT(DISTINCT match_id) AS n FROM participations WHERE player_id = ?'
      ),
      matchWins: db.prepare(
        "SELECT COUNT(*) AS n FROM match_winners WHERE player_id = ? AND scope = 'match'"
      ),
      roundWins: db.prepare(
        "SELECT COUNT(*) AS n FROM match_winners WHERE player_id = ? AND scope = 'round'"
      ),
      perGamePoints: db.prepare(
        `SELECT m.game_id AS gid, COALESCE(SUM(se.points), 0) AS pts
         FROM score_events se JOIN matches m ON m.id = se.match_id
         WHERE se.player_id = ? GROUP BY m.game_id`
      ),
      perGamePlayed: db.prepare(
        `SELECT m.game_id AS gid, COUNT(DISTINCT p.match_id) AS n
         FROM participations p JOIN matches m ON m.id = p.match_id
         WHERE p.player_id = ? GROUP BY m.game_id`
      ),
      perGameWins: db.prepare(
        `SELECT m.game_id AS gid, mw.scope AS scope, COUNT(*) AS n
         FROM match_winners mw JOIN matches m ON m.id = mw.match_id
         WHERE mw.player_id = ? GROUP BY m.game_id, mw.scope`
      ),
      historyPage: db.prepare(
        `SELECT m.id AS matchId, m.game_id AS gameId, m.started_at AS startedAt,
                m.ended_at AS endedAt,
                COALESCE((
                  SELECT SUM(se.points) FROM score_events se
                  WHERE se.match_id = m.id AND se.player_id = @pid
                ), 0) AS pointsEarned,
                EXISTS(
                  SELECT 1 FROM match_winners w
                  WHERE w.match_id = m.id AND w.player_id = @pid AND w.scope = 'match'
                ) AS wonMatch,
                EXISTS(
                  SELECT 1 FROM match_winners w
                  WHERE w.match_id = m.id AND w.player_id = @pid AND w.scope = 'round'
                ) AS wonRound
         FROM participations p JOIN matches m ON m.id = p.match_id
         WHERE p.player_id = @pid
         ORDER BY m.started_at DESC
         LIMIT @limit OFFSET @offset`
      ),
      identity: db.prepare(
        `SELECT g.display_name AS gName, g.avatar_url AS gAvatar, g.claimed_user_id AS claimedUserId,
                u.display_name AS uName, u.avatar_url AS uAvatar
         FROM guests g LEFT JOIN users u ON u.id = g.claimed_user_id
         WHERE g.player_id = ?`
      ),
    };
  }
  return statements;
}

/** Canonical identity for a profile page; null when the playerId is unknown. */
export function getProfileIdentity(playerId: string): ProfileIdentity | null {
  const row = stmts().identity.get(playerId) as
    | { gName: string; gAvatar: string | null; claimedUserId: string | null; uName: string | null; uAvatar: string | null }
    | undefined;
  if (!row) return null;
  // A claimed account presents its Google name/picture; everyone else their
  // live-updated guests row.
  if (row.claimedUserId && row.uName) {
    return { playerId, displayName: row.uName, avatarUrl: row.uAvatar, identityKind: 'user' };
  }
  return {
    playerId,
    displayName: row.gName || 'لاعب',
    avatarUrl: row.gAvatar,
    identityKind: 'guest',
  };
}

export function getPlayerTotals(playerId: string): PlayerTotals {
  const s = stmts();
  return {
    totalPoints: (s.totalPoints.get(playerId) as { p: number }).p,
    matchesPlayed: (s.matchesPlayed.get(playerId) as { n: number }).n,
    matchWins: (s.matchWins.get(playerId) as { n: number }).n,
    roundWins: (s.roundWins.get(playerId) as { n: number }).n,
  };
}

export function getPerGameStats(playerId: string): PerGameStat[] {
  const s = stmts();
  const map = new Map<string, PerGameStat>();
  const ensure = (gid: string): PerGameStat => {
    let entry = map.get(gid);
    if (!entry) {
      entry = { gameId: gid, totalPoints: 0, matchesPlayed: 0, matchWins: 0, roundWins: 0 };
      map.set(gid, entry);
    }
    return entry;
  };

  for (const r of s.perGamePoints.all(playerId) as { gid: string; pts: number }[]) {
    ensure(r.gid).totalPoints = r.pts;
  }
  for (const r of s.perGamePlayed.all(playerId) as { gid: string; n: number }[]) {
    ensure(r.gid).matchesPlayed = r.n;
  }
  for (const r of s.perGameWins.all(playerId) as { gid: string; scope: string; n: number }[]) {
    if (r.scope === 'match') ensure(r.gid).matchWins = r.n;
    else if (r.scope === 'round') ensure(r.gid).roundWins = r.n;
  }

  return [...map.values()].sort((a, b) => b.totalPoints - a.totalPoints);
}

export function getMatchHistory(
  playerId: string,
  limit = 10,
  offset = 0
): { items: MatchHistoryItem[]; total: number } {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const safeOffset = Math.max(0, Math.floor(offset) || 0);
  const items = (
    stmts().historyPage.all({ pid: playerId, limit: safeLimit, offset: safeOffset }) as {
      matchId: string;
      gameId: string;
      startedAt: number;
      endedAt: number | null;
      pointsEarned: number;
      wonMatch: 0 | 1;
      wonRound: 0 | 1;
    }[]
  ).map((r) => ({
    matchId: r.matchId,
    gameId: r.gameId,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    pointsEarned: r.pointsEarned,
    wonMatch: r.wonMatch === 1,
    wonRound: r.wonRound === 1,
  }));
  return { items, total: getPlayerTotals(playerId).matchesPlayed };
}
