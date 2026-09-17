/**
 * Phase 4D — CompetitiveQueryService.
 *
 * Read-only composition layer that turns the Phase 4A–4C services into stable
 * API DTOs. It performs NO competitive business logic: bracket data comes from
 * `BracketService`, match data from `TournamentMatchService`, participants from
 * `ParticipantService`, tournament metadata from `TournamentService`, and rank
 * is derived from LP via the Phase 4A `computeRank`. Any direct SQL here is a
 * read-only projection, never a rule.
 */

import { getDb } from '../db/db';
import {
  getTournamentById,
  getTournamentWithGameInfo,
  getTournamentsWithGameInfo,
  type TournamentWithGame,
} from '../games/TournamentService';
import { getParticipantsByTournament } from '../games/ParticipantService';
import { getTournamentBracket, type TournamentBracketView } from './BracketService';
import {
  getMatch,
  getMatchParticipants,
  getTournamentChampion,
  getTournamentMatches,
  type TournamentMatchRow,
  type MatchParticipantRow,
} from './TournamentMatchService';
import { computeRank, type ComputedRank } from './ranks';

export interface MatchParticipantDto {
  playerId: string;
  slot: number;
  seed: number | null;
  /** True when this participant reached the round via a first-round bye. */
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
  /** Both participant slots are known and the match is not terminal. */
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

export interface TournamentSummaryDto {
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

export interface ParticipantDto {
  playerId: string;
  displayName: string | null;
  avatarUrl: string | null;
  source: string;
  status: string;
  seed: number | null;
  eliminated: boolean;
  advanced: boolean;
  champion: boolean;
  /**
   * Competitive LP/Elo for this tournament's game. Null until the participant
   * has a competitive profile (which is created lazily on the first scored
   * match — registration alone never creates one).
   */
  lp: number | null;
  elo: number | null;
  /**
   * Rank derived from LP via the single `computeRank` source of truth. For a
   * participant with no profile yet this is the base rank `computeRank(0)`
   * (Bronze 3) — the documented initial competitive rank — and `unranked` is
   * true. No LP/Elo/W-L is fabricated.
   */
  rank: ComputedRank;
  /** True when the participant has no competitive profile yet. */
  unranked: boolean;
}

export interface PlayerTournamentStateDto {
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

export interface PlayerCompetitiveProfileDto {
  gameId: string;
  gameNameAr: string | null;
  lp: number;
  elo: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  rank: ComputedRank;
}

const PARTICIPANT_STATUSES = new Set(['registered', 'confirmed']);

function toMatchDto(match: TournamentMatchRow, participants: MatchParticipantRow[]): MatchDto {
  const players: MatchParticipantDto[] = participants.map((p) => ({
    playerId: p.player_id,
    slot: p.slot,
    seed: p.seed,
    advancedByBye: p.seed !== null && match.round_no > 1,
  }));
  const terminal =
    match.status === 'completed' || match.status === 'cancelled' || match.status === 'disputed';
  return {
    id: match.id,
    tournamentId: match.tournament_id,
    gameId: match.game_id,
    roundNo: match.round_no,
    slotNo: match.slot_no,
    status: match.status,
    bestOf: match.best_of,
    winnerPlayerId: match.winner_player_id,
    nextMatchId: match.next_match_id,
    nextMatchSlot: match.next_match_slot,
    scheduledAt: match.scheduled_at,
    startedAt: match.started_at,
    completedAt: match.completed_at,
    ready: players.length === 2 && !terminal,
    players,
  };
}

function toTournamentSummary(tournament: TournamentWithGame): TournamentSummaryDto {
  const matches = getTournamentMatches(tournament.id);
  const bracket = getTournamentBracket(tournament.id);
  const completedMatchCount = matches.filter((m) => m.status === 'completed').length;
  const remainingMatchCount = matches.filter(
    (m) => m.status === 'pending' || m.status === 'scheduled' || m.status === 'active'
  ).length;

  return {
    id: tournament.id,
    gameId: tournament.game_id,
    gameSlug: tournament.game_slug,
    gameNameAr: tournament.game_name_ar,
    nameAr: tournament.name_ar,
    descriptionAr: tournament.description_ar,
    imageUrl: tournament.image_url,
    status: tournament.status,
    maxParticipants: tournament.max_participants,
    startsAt: tournament.starts_at,
    endsAt: tournament.ends_at,
    participantCount: bracket?.participantCount ?? 0,
    bracketGenerated: matches.length > 0,
    totalRounds: bracket?.totalRounds ?? 0,
    byes: bracket?.byes ?? 0,
    matchCount: matches.length,
    completedMatchCount,
    remainingMatchCount,
    championPlayerId: getTournamentChampion(tournament.id),
  };
}

/** Public: all tournaments, optionally filtered by game and/or status. */
export function listTournaments(filters?: { gameId?: string; status?: string }): TournamentSummaryDto[] {
  let tournaments = getTournamentsWithGameInfo();
  if (filters?.gameId) tournaments = tournaments.filter((t) => t.game_id === filters.gameId);
  if (filters?.status) tournaments = tournaments.filter((t) => t.status === filters.status);
  return tournaments.map(toTournamentSummary);
}

export function getTournamentSummary(tournamentId: string): TournamentSummaryDto | null {
  const tournament = getTournamentWithGameInfo(tournamentId);
  if (!tournament) return null;
  return toTournamentSummary(tournament);
}

export function getBracketDto(tournamentId: string): BracketDto | null {
  const view: TournamentBracketView | null = getTournamentBracket(tournamentId);
  if (!view) return null;
  return {
    tournamentId: view.tournamentId,
    gameId: view.gameId,
    tournamentStatus: view.tournamentStatus,
    bracketSize: view.bracketSize,
    totalRounds: view.totalRounds,
    byes: view.byes,
    participantCount: view.participantCount,
    rounds: view.rounds.map((round) => ({
      roundNo: round.roundNo,
      nameEn: round.nameEn,
      nameAr: round.nameAr,
      matches: round.matches.map((m) => ({
        id: m.id,
        tournamentId: view.tournamentId,
        gameId: view.gameId,
        roundNo: m.roundNo,
        slotNo: m.slotNo,
        status: m.status,
        bestOf: m.bestOf,
        winnerPlayerId: m.winnerPlayerId,
        nextMatchId: m.nextMatchId,
        nextMatchSlot: m.nextMatchSlot,
        scheduledAt: m.scheduledAt,
        startedAt: m.startedAt,
        completedAt: m.completedAt,
        ready:
          m.participants.length === 2 &&
          m.status !== 'completed' &&
          m.status !== 'cancelled' &&
          m.status !== 'disputed',
        players: m.participants.map((p) => ({
          playerId: p.playerId,
          slot: p.slot,
          seed: p.seed,
          advancedByBye: p.seed !== null && m.roundNo > 1,
        })),
      })),
    })),
  };
}

export function getMatchesDto(tournamentId: string): MatchDto[] {
  const matches = getTournamentMatches(tournamentId);
  return matches.map((m) => toMatchDto(m, getMatchParticipants(m.id)));
}

export function getMatchDto(matchId: string): MatchDto | null {
  const match = getMatch(matchId);
  if (!match) return null;
  return toMatchDto(match, getMatchParticipants(match.id));
}

export interface MatchDetailDto {
  match: MatchDto;
  tournament: {
    id: string;
    nameAr: string;
    gameId: string;
    gameNameAr: string;
    status: string;
  } | null;
}

export function getMatchDetail(matchId: string): MatchDetailDto | null {
  const match = getMatch(matchId);
  if (!match) return null;
  const tournament = getTournamentWithGameInfo(match.tournament_id);
  return {
    match: toMatchDto(match, getMatchParticipants(match.id)),
    tournament: tournament
      ? {
          id: tournament.id,
          nameAr: tournament.name_ar,
          gameId: tournament.game_id,
          gameNameAr: tournament.game_name_ar,
          status: tournament.status,
        }
      : null,
  };
}

interface DerivedPlayerState {
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

/** Derives tournament-scoped player state from the authoritative match graph. */
function computePlayerStates(tournamentId: string): Map<string, DerivedPlayerState> {
  const states = new Map<string, DerivedPlayerState>();
  const ensure = (playerId: string): DerivedPlayerState => {
    let state = states.get(playerId);
    if (!state) {
      state = {
        seed: null,
        currentMatchId: null,
        eliminated: false,
        advanced: false,
        champion: false,
        completedMatches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
      };
      states.set(playerId, state);
    }
    return state;
  };

  const matches = getTournamentMatches(tournamentId);
  for (const match of matches) {
    const participants = getMatchParticipants(match.id);
    for (const participant of participants) {
      const state = ensure(participant.player_id);
      if (state.seed === null && match.round_no === 1 && participant.seed !== null) {
        state.seed = participant.seed;
      }
      if (match.status === 'pending' || match.status === 'scheduled' || match.status === 'active') {
        state.currentMatchId = match.id;
        state.advanced = true;
      } else if (match.status === 'completed') {
        state.completedMatches += 1;
        if (match.winner_player_id === null) {
          // A corrected draw: neither win nor loss, and no elimination.
          state.draws += 1;
        } else if (match.winner_player_id === participant.player_id) {
          state.wins += 1;
        } else {
          state.losses += 1;
          state.eliminated = true;
        }
      }
    }
  }

  const champion = getTournamentChampion(tournamentId);
  if (champion && states.has(champion)) {
    const state = states.get(champion)!;
    state.champion = true;
    state.eliminated = false;
  }
  // A player still waiting in a live match is not eliminated.
  for (const state of states.values()) {
    if (state.currentMatchId !== null) state.eliminated = false;
  }

  return states;
}

export function getParticipantsDto(tournamentId: string): ParticipantDto[] {
  const rows = getParticipantsByTournament(tournamentId);
  const states = computePlayerStates(tournamentId);
  const champion = getTournamentChampion(tournamentId);

  // Targeted competitive lookup for exactly this tournament's participants —
  // independent of any leaderboard limit, so bracket/roster rank metadata is
  // available even for players outside the top-N leaderboard.
  const tournament = getTournamentById(tournamentId);
  const profileByPlayer = new Map<string, { lp: number; elo: number }>();
  const eligibleIds = rows
    .filter((row) => PARTICIPANT_STATUSES.has(row.status))
    .map((row) => row.player_id);
  if (tournament && eligibleIds.length > 0) {
    const placeholders = eligibleIds.map(() => '?').join(',');
    const profiles = getDb()
      .prepare(
        `SELECT player_id, lp, elo FROM competitive_profiles
          WHERE game_id = ? AND player_id IN (${placeholders})`
      )
      .all(tournament.game_id, ...eligibleIds) as { player_id: string; lp: number; elo: number }[];
    for (const p of profiles) profileByPlayer.set(p.player_id, { lp: p.lp, elo: p.elo });
  }

  return rows
    .filter((row) => PARTICIPANT_STATUSES.has(row.status))
    .map((row) => {
      const state = states.get(row.player_id);
      const profile = profileByPlayer.get(row.player_id);
      return {
        playerId: row.player_id,
        displayName: row.youtube_name,
        avatarUrl: row.youtube_avatar_url,
        source: row.source,
        status: row.status,
        seed: state?.seed ?? null,
        eliminated: state?.eliminated ?? false,
        advanced: state?.advanced ?? false,
        champion: champion === row.player_id,
        lp: profile?.lp ?? null,
        elo: profile?.elo ?? null,
        rank: computeRank(profile?.lp ?? 0),
        unranked: !profile,
      };
    });
}

export function getPlayerTournamentState(
  tournamentId: string,
  playerId: string
): PlayerTournamentStateDto {
  const participant = getDb()
    .prepare('SELECT status FROM tournament_participants WHERE tournament_id = ? AND player_id = ?')
    .get(tournamentId, playerId) as { status: string } | undefined;

  if (!participant) {
    return {
      tournamentId,
      playerId,
      registered: false,
      participantStatus: null,
      seed: null,
      currentMatchId: null,
      eliminated: false,
      advanced: false,
      champion: false,
      completedMatches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
  }

  const state = computePlayerStates(tournamentId).get(playerId);
  return {
    tournamentId,
    playerId,
    registered: PARTICIPANT_STATUSES.has(participant.status),
    participantStatus: participant.status,
    seed: state?.seed ?? null,
    currentMatchId: state?.currentMatchId ?? null,
    eliminated: state?.eliminated ?? false,
    advanced: state?.advanced ?? false,
    champion: getTournamentChampion(tournamentId) === playerId,
    completedMatches: state?.completedMatches ?? 0,
    wins: state?.wins ?? 0,
    losses: state?.losses ?? 0,
    draws: state?.draws ?? 0,
  };
}

/** Every tournament a player is registered in (optionally one tournament). */
export function getPlayerTournaments(
  playerId: string,
  tournamentId?: string
): PlayerTournamentStateDto[] {
  const db = getDb();
  const rows = (
    tournamentId
      ? db
          .prepare('SELECT tournament_id FROM tournament_participants WHERE player_id = ? AND tournament_id = ?')
          .all(playerId, tournamentId)
      : db.prepare('SELECT tournament_id FROM tournament_participants WHERE player_id = ?').all(playerId)
  ) as { tournament_id: string }[];
  return rows.map((row) => getPlayerTournamentState(row.tournament_id, playerId));
}

export interface GameLeaderboardEntryDto {
  /** 1-based display position (ordered by LP desc, then Elo desc). */
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

export interface GameLeaderboardDto {
  gameId: string;
  gameNameAr: string | null;
  players: GameLeaderboardEntryDto[];
}

export const DEFAULT_LEADERBOARD_LIMIT = 100;
export const MAX_LEADERBOARD_LIMIT = 500;

/**
 * Public per-game competitive leaderboard. Read-only projection of
 * `competitive_profiles` for one `game_id` (isolation is by the WHERE clause),
 * joined to the player identity, with rank derived from LP. No ranking rule is
 * evaluated here. Returns null when the game itself does not exist.
 */
export function getGameLeaderboard(
  gameId: string,
  limit: number = DEFAULT_LEADERBOARD_LIMIT
): GameLeaderboardDto | null {
  const db = getDb();
  const game = db
    .prepare('SELECT id, name_ar FROM games WHERE id = ?')
    .get(gameId) as { id: string; name_ar: string } | undefined;
  if (!game) return null;

  const rawLimit = Number(limit);
  const safeLimit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_LEADERBOARD_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_LEADERBOARD_LIMIT;

  const rows = db
    .prepare(
      `SELECT cp.player_id AS player_id, cp.lp AS lp, cp.elo AS elo,
              cp.matches_played AS matches_played, cp.wins AS wins,
              cp.losses AS losses, cp.draws AS draws,
              g.display_name AS display_name, g.avatar_url AS avatar_url
         FROM competitive_profiles cp
         LEFT JOIN guests g ON g.player_id = cp.player_id
        WHERE cp.game_id = ?
        ORDER BY cp.lp DESC, cp.elo DESC, cp.player_id ASC
        LIMIT ?`
    )
    .all(gameId, safeLimit) as {
    player_id: string;
    lp: number;
    elo: number;
    matches_played: number;
    wins: number;
    losses: number;
    draws: number;
    display_name: string | null;
    avatar_url: string | null;
  }[];

  return {
    gameId: game.id,
    gameNameAr: game.name_ar,
    players: rows.map((row, index) => ({
      position: index + 1,
      playerId: row.player_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      lp: row.lp,
      elo: row.elo,
      matchesPlayed: row.matches_played,
      wins: row.wins,
      losses: row.losses,
      draws: row.draws,
      rank: computeRank(row.lp),
    })),
  };
}

export function getPlayerCompetitiveProfiles(playerId: string): PlayerCompetitiveProfileDto[] {
  const rows = getDb()
    .prepare(
      `SELECT cp.game_id AS game_id, cp.lp AS lp, cp.elo AS elo,
              cp.matches_played AS matches_played, cp.wins AS wins,
              cp.losses AS losses, cp.draws AS draws, g.name_ar AS game_name_ar
         FROM competitive_profiles cp
         LEFT JOIN games g ON g.id = cp.game_id
        WHERE cp.player_id = ?
        ORDER BY cp.game_id ASC`
    )
    .all(playerId) as {
    game_id: string;
    lp: number;
    elo: number;
    matches_played: number;
    wins: number;
    losses: number;
    draws: number;
    game_name_ar: string | null;
  }[];

  return rows.map((row) => ({
    gameId: row.game_id,
    gameNameAr: row.game_name_ar,
    lp: row.lp,
    elo: row.elo,
    matchesPlayed: row.matches_played,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    rank: computeRank(row.lp),
  }));
}
