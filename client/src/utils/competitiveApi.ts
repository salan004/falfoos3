import { apiFetch } from './api';
import type {
  BracketDto,
  CompetitiveRosterEntry,
  GameLeaderboard,
  MatchDto,
  PlayerCompetitiveProfile,
  PlayerTournamentState,
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

export async function fetchGameLeaderboard(gameId: string, limit?: number): Promise<ApiResult<{ leaderboard: GameLeaderboard }>> {
  const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
  return jsonRequest(`/api/games/${gameId}/competitive${query}`);
}

/* --------------------------- player competitive --------------------------- */

export async function fetchPlayerCompetitiveProfiles(
  playerId: string
): Promise<ApiResult<{ profiles: PlayerCompetitiveProfile[] }>> {
  return jsonRequest(`/api/players/${encodeURIComponent(playerId)}/competitive`);
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
  winnerPlayerId: string;
  resultSource?: 'admin' | 'auto' | 'import';
  idempotencyKey?: string;
}

export async function recordMatchResult(
  tournamentId: string,
  matchId: string,
  body: RecordResultBody
): Promise<ApiResult<{ result: { winnerPlayerId: string; tournamentCompleted: boolean; championPlayerId: string | null; alreadyProcessed: boolean } }>> {
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

/* ------------------------------ correction -------------------------------- */

export interface CorrectionResultDto {
  matchId: string;
  tournamentId: string;
  gameId: string;
  status: string;
  previousWinnerPlayerId: string | null;
  correctedWinnerPlayerId: string | null;
  changed: boolean;
  alreadyProcessed: boolean;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  affectedPlayerIds: string[];
}

export interface CorrectMatchResultBody {
  /** null records the corrected outcome as a draw. */
  correctedWinnerPlayerId: string | null;
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
