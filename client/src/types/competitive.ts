/**
 * Phase 4E — client mirrors of the Phase 4D competitive API DTOs.
 *
 * These interfaces describe data RECEIVED from the backend. The frontend never
 * computes LP, Elo, rank, advancement, brackets or champions — it only renders
 * what the authoritative services returned.
 */

export interface ComputedRank {
  rankKey: string;
  rankName: string;
  rankNameEn: string;
  tierKey: string;
  division: number;
  levelIndex: number;
  currentThreshold: number;
  nextThreshold: number | null;
  lpIntoLevel: number;
  lpForNext: number | null;
  progressPct: number;
}

export interface TournamentSummary {
  id: string;
  gameId: string;
  gameSlug: string;
  gameNameAr: string;
  nameAr: string;
  descriptionAr: string | null;
  imageUrl: string | null;
  status: string;
  maxParticipants: number | null;
  startsAt: number | null;
  endsAt: number | null;
  participantCount: number;
  bracketGenerated: boolean;
  totalRounds: number;
  byes: number;
  matchCount: number;
  completedMatchCount: number;
  remainingMatchCount: number;
  championPlayerId: string | null;
}

export interface MatchParticipantDto {
  playerId: string;
  slot: number;
  seed: number | null;
  advancedByBye: boolean;
}

export interface MatchDto {
  id: string;
  tournamentId: string;
  gameId: string;
  roundNo: number;
  slotNo: number;
  status: string;
  bestOf: number | null;
  winnerPlayerId: string | null;
  nextMatchId: string | null;
  nextMatchSlot: number | null;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  ready: boolean;
  players: MatchParticipantDto[];
}

export interface BracketRoundDto {
  roundNo: number;
  nameEn: string;
  nameAr: string;
  matches: MatchDto[];
}

export interface BracketDto {
  tournamentId: string;
  gameId: string;
  tournamentStatus: string;
  bracketSize: number;
  totalRounds: number;
  byes: number;
  participantCount: number;
  rounds: BracketRoundDto[];
}

export interface CompetitiveRosterEntry {
  playerId: string;
  displayName: string | null;
  avatarUrl: string | null;
  source: string;
  status: string;
  seed: number | null;
  eliminated: boolean;
  advanced: boolean;
  champion: boolean;
  /** Competitive LP/Elo for this tournament's game; null until a profile exists. */
  lp: number | null;
  elo: number | null;
  /** Rank derived from LP (or the base Bronze rank when unranked). */
  rank: ComputedRank;
  /** True when the participant has no competitive profile yet. */
  unranked: boolean;
}

export interface GameLeaderboardEntry {
  position: number;
  playerId: string;
  displayName: string | null;
  avatarUrl: string | null;
  lp: number;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  rank: ComputedRank;
}

export interface GameLeaderboard {
  gameId: string;
  gameNameAr: string | null;
  players: GameLeaderboardEntry[];
}

export type CompetitiveProfileMap = Map<string, GameLeaderboardEntry>;

/** Mirror of GET /api/players/:playerId/competitive rows (per game). */
export interface PlayerCompetitiveProfile {
  gameId: string;
  gameNameAr: string | null;
  /** Stable game slug (e.g. `dueling_ground`); null for a legacy game row. */
  gameSlug: string | null;
  /** Game artwork URL from the catalog; null when the game has no image. */
  gameImageUrl: string | null;
  lp: number;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  rank: ComputedRank;
  /**
   * True when the player has no competitive profile for this game yet
   * (only present in the `?allGames=1` projection). Defaults are server-supplied.
   */
  unranked: boolean;
}

/** Mirror of GET /api/players/:playerId/tournaments and .../players/:playerId. */
export interface PlayerTournamentState {
  tournamentId: string;
  playerId: string;
  registered: boolean;
  participantStatus: string | null;
  seed: number | null;
  currentMatchId: string | null;
  eliminated: boolean;
  advanced: boolean;
  champion: boolean;
  completedMatches: number;
  wins: number;
  losses: number;
  draws: number;
}
