import { apiFetch } from './api';
import type {
  BracketDto,
  CompetitionType,
  CompetitiveRosterEntry,
  GameLeaderboard,
  MatchDto,
  PlayerCompetitiveProfile,
  PlayerTournamentState,
  TeamDto,
  TeamFormation,
  TournamentSummary,
} from '../types/competitive';

/**
 * Phase 4E — typed access to the Phase 4D public/admin tournament APIs.
 *
 * A thin convenience layer over the existing `apiFetch` (same credentials
 * handling). It never computes competitive values — it only moves DTOs.
 */

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await apiFetch(path, init);
    const text = await res.text();
    let data: T | null = null;
    let error: string | null = null;
    if (text.length > 0) {
      try {
        const parsed = JSON.parse(text) as T & { error?: string; message?: string };
        data = parsed;
        if (!res.ok) error = parsed.error ?? parsed.message ?? 'request_failed';
      } catch {
        if (!res.ok) error = 'request_failed';
      }
    } else if (!res.ok) {
      error = 'request_failed';
    }
    return { ok: res.ok, status: res.status, data, error };
  } catch {
    return { ok: false, status: 0, data: null, error: 'network_error' };
  }
}

/* ------------------------------- public reads ----------------------------- */

export async function fetchTournamentSummary(id: string): Promise<ApiResult<{ tournament: TournamentSummary }>> {
  return jsonRequest(`/api/tournaments/${id}/summary`);
}

export async function fetchTournamentRoster(id: string): Promise<ApiResult<{ participants: CompetitiveRosterEntry[] }>> {
  return jsonRequest(`/api/tournaments/${id}/roster`);
}

export async function fetchTournamentBracket(id: string): Promise<ApiResult<{ bracket: BracketDto }>> {
  return jsonRequest(`/api/tournaments/${id}/bracket`);
}

export async function fetchTournamentMatches(id: string): Promise<ApiResult<{ matches: MatchDto[] }>> {
  return jsonRequest(`/api/tournaments/${id}/matches`);
}

/* ----------------------------------- teams -------------------------------- */

export interface TournamentTeamsResponse {
  teams: TeamDto[];
  competitionType?: CompetitionType;
  teamFormation?: TeamFormation | null;
  teamsLockedAt?: number | null;
  /** Session-aware (server-authoritative only for hints). */
  playerTeamId?: string | null;
  canSelect?: boolean;
}

/** Roadmap #2 — public team read for a tournament. */
export async function fetchTournamentTeams(id: string): Promise<ApiResult<TournamentTeamsResponse>> {
  return jsonRequest(`/api/tournaments/${id}/teams`);
}

export interface TeamSelectionResponse {
  teams: TeamDto[];
  playerTeamId: string | null;
  idempotent: boolean;
  switched: boolean;
}

/** Roadmap #2 — the server derives the player from the session; only teamId is sent. */
export async function selectTournamentTeam(
  tournamentId: string,
  teamId: string
): Promise<ApiResult<TeamSelectionResponse>> {
  return jsonRequest(`/api/tournaments/${tournamentId}/team-selection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId }),
  });
}

/** Roadmap #2 — admin team inspection. */
export async function adminFetchTournamentTeams(
  tournamentId: string
): Promise<ApiResult<{ teams: TeamDto[] }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/teams`);
}

/** Roadmap #2 — admin random re-distribution (before lock). */
export async function adminRandomizeTournamentTeams(
  tournamentId: string
): Promise<ApiResult<{ teams: TeamDto[] }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/teams/randomize`, { method: 'POST' });
}

/** Roadmap #2 — admin correction of a single player's team. */
export async function adminAssignTournamentTeam(
  tournamentId: string,
  playerId: string,
  teamId: string
): Promise<ApiResult<{ team: TeamDto }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/teams/assignment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, teamId }),
  });
}

export async function fetchGameLeaderboard(gameId: string, limit?: number): Promise<ApiResult<{ leaderboard: GameLeaderboard }>> {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return jsonRequest(`/api/games/${gameId}/competitive${query}`);
}

/* --------------------------- player competitive --------------------------- */

/**
 * Player competitive profiles. With `allGames` the server returns one entry for
 * every active game (including `unranked: true` games the player has no profile
 * for), so the UI never fabricates competitive state.
 */
export async function fetchPlayerCompetitiveProfiles(
  playerId: string,
  allGames = false
): Promise<ApiResult<{ profiles: PlayerCompetitiveProfile[] }>> {
  const query = allGames ? '?allGames=1' : '';
  return jsonRequest(`/api/players/${encodeURIComponent(playerId)}/competitive${query}`);
}

export async function fetchPlayerTournaments(
  playerId: string,
  tournamentId?: string
): Promise<ApiResult<{ states: PlayerTournamentState[] }>> {
  const query = tournamentId ? `?tournamentId=${encodeURIComponent(tournamentId)}` : '';
  return jsonRequest(`/api/players/${encodeURIComponent(playerId)}/tournaments${query}`);
}

export async function fetchTournamentPlayerState(
  tournamentId: string,
  playerId: string
): Promise<ApiResult<{ state: PlayerTournamentState }>> {
  return jsonRequest(
    `/api/tournaments/${encodeURIComponent(tournamentId)}/players/${encodeURIComponent(playerId)}`
  );
}

/* ------------------------------ admin writes ------------------------------ */

export async function generateBracket(tournamentId: string): Promise<ApiResult<{ bracket: BracketDto }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/bracket`, { method: 'POST' });
}

export interface RecordResultBody {
  /** Exactly one of winnerPlayerId / winnerTeamId is required. */
  winnerPlayerId?: string;
  winnerTeamId?: string;
  resultSource?: 'admin' | 'auto' | 'import';
  idempotencyKey?: string;
}

export interface RecordResultResponse {
  winnerPlayerId: string | null;
  winnerTeamId: string | null;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  championTeamId: string | null;
  alreadyProcessed: boolean;
}

export async function recordMatchResult(
  tournamentId: string,
  matchId: string,
  body: RecordResultBody
): Promise<ApiResult<{ result: RecordResultResponse }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/matches/${matchId}/result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export type AdminMatchStatus = 'scheduled' | 'active' | 'cancelled' | 'disputed';

export async function setMatchStatus(
  tournamentId: string,
  matchId: string,
  status: AdminMatchStatus
): Promise<ApiResult<{ match: MatchDto | null }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/matches/${matchId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

export async function openDispute(
  tournamentId: string,
  matchId: string
): Promise<ApiResult<{ match: MatchDto | null }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/matches/${matchId}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'open' }),
  });
}

export async function resolveDispute(
  tournamentId: string,
  matchId: string,
  resolution: 'completed' | 'cancelled'
): Promise<ApiResult<{ match: MatchDto | null }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/matches/${matchId}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'resolve', resolution }),
  });
}

export interface CreateTournamentBody {
  game_id: string;
  name_ar: string;
  description_ar?: string;
  image_url?: string;
  max_participants?: number;
  starts_at?: number;
  ends_at?: number;
  status?: string;
  /** Roadmap #2 — competition configuration. */
  competition_type?: CompetitionType;
  team_formation?: TeamFormation | null;
  team1_name?: string | null;
  team2_name?: string | null;
}

export async function createTournament(
  body: CreateTournamentBody
): Promise<ApiResult<{ tournament: TournamentSummary }>> {
  return jsonRequest('/api/admin/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Cancels a tournament. Reuses the existing admin PATCH endpoint and its
 * lifecycle validation; cancellation is non-destructive (status freeze only).
 */
export async function cancelTournament(
  tournamentId: string
): Promise<ApiResult<{ tournament: TournamentSummary }>> {
  return jsonRequest(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
}

/* ------------------------------ visibility -------------------------------- */

/**
 * R5 — hide a tournament from normal listings/discovery. Non-destructive and
 * reversible: no data, rows, or images are deleted and the lifecycle status is
 * never changed. Uses the primary PATCH visibility API.
 */
export async function hideTournament(
  tournamentId: string
): Promise<ApiResult<{ tournament: TournamentSummary }>> {
  return jsonRequest(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: true }),
  });
}

/** R5 — restore a hidden tournament's visibility without changing its status. */
export async function restoreTournament(
  tournamentId: string
): Promise<ApiResult<{ tournament: TournamentSummary }>> {
  return jsonRequest(`/api/admin/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hidden: false }),
  });
}

/* ------------------------------ correction -------------------------------- */

export interface CorrectionResultDto {
  matchId: string;
  tournamentId: string;
  gameId: string;
  status: string;
  previousWinnerPlayerId: string | null;
  previousWinnerTeamId: string | null;
  correctedWinnerPlayerId: string | null;
  correctedWinnerTeamId: string | null;
  changed: boolean;
  alreadyProcessed: boolean;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  championTeamId: string | null;
  affectedPlayerIds: string[];
}

export interface CorrectMatchResultBody {
  /** Exactly one is set; both null records the corrected outcome as a draw. */
  correctedWinnerPlayerId?: string | null;
  correctedWinnerTeamId?: string | null;
  reason: string;
  idempotencyKey?: string;
}

export async function correctMatchResult(
  tournamentId: string,
  matchId: string,
  body: CorrectMatchResultBody
): Promise<ApiResult<{ correction: CorrectionResultDto }>> {
  return jsonRequest(`/api/admin/tournaments/${tournamentId}/matches/${matchId}/result`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
