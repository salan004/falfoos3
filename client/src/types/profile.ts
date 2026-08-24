/**
 * Phase 12B/12C — mirror of GET /api/me/profile and
 * GET /api/players/:playerId/profile payloads (server/src/db/stats.ts).
 */

export interface ProfileIdentity {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  identityKind: 'guest' | 'user';
}

export interface PlayerTotals {
  totalPoints: number;
  matchesPlayed: number;
  /** Full-match victories — the main "Wins" statistic. */
  matchWins: number;
  /** Round-scoped victories (shown in per-game statistics only). */
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
  pointsEarned: number;
  wonMatch: boolean;
  wonRound: boolean;
}

export interface LevelInfo {
  level: number;
  titleAr: string;
  currentLevelPoints: number;
  nextLevelAt: number | null;
  progressPct: number;
}

export interface AchievementView {
  id: string;
  titleAr: string;
  descriptionAr: string;
  icon: string;
  awardedAt: number;
}

export interface PlayerProfile {
  player: ProfileIdentity;
  totals: PlayerTotals;
  perGame: PerGameStat[];
  recentMatches: MatchHistoryItem[];
  historyTotal: number;
  level: LevelInfo;
  achievements: AchievementView[];
}

/** Phase 13 — mirror of GET /api/leaderboard/all-time rows. */
export interface AllTimeLeaderRow {
  rank: number;
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  identityKind: 'guest' | 'user';
  totalPoints: number;
  matchesPlayed: number;
  matchWins: number;
  level: LevelInfo;
}
