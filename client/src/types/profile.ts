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

/** Phase 2.y — RECREATIONAL (Stream Games) profile block. */
export interface RecreationalProfileView {
  source: 'stream_games';
  totals: PlayerTotals;
  perGame: PerGameStat[];
  recentMatches: MatchHistoryItem[];
  historyTotal: number;
  level: LevelInfo;
  achievements: AchievementView[];
}

export interface CompetitiveProgressView {
  current: number;
  next: number | null;
  pct: number;
  intoLevel: number;
  forNext: number | null;
}

/** Phase 2.z — GLOBAL competitive progression (cross-game). */
export interface CompetitiveProfileView {
  source: 'competitive_tournaments';
  status: 'active';
  xp: number;
  level: number;
  /** Visual progression tier 1–4. */
  tier: number;
  tierLabelAr: string;
  isMax: boolean;
  progress: CompetitiveProgressView;
  matches: number;
  wins: number;
}

export interface PlayerProfile {
  player: ProfileIdentity;
  totals: PlayerTotals;
  perGame: PerGameStat[];
  recentMatches: MatchHistoryItem[];
  historyTotal: number;
  level: LevelInfo;
  achievements: AchievementView[];
  /** RECREATIONAL (Stream Games) — explicit ownership. */
  recreational?: RecreationalProfileView;
  /** GLOBAL competitive progression — explicit ownership. */
  competitive?: CompetitiveProfileView;
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
