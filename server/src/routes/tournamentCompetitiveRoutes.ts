/**
 * Phase 4D — public tournament/competitive read routes (no authentication).
 *
 * Thin transport only: every response is composed by `CompetitiveQueryService`
 * from the Phase 4A–4C services. No competitive rule is evaluated here.
 *
 * Only NEW sub-paths are registered so the existing public routes in
 * `gamesRoutes` (`/api/tournaments`, `/api/tournaments/:id`,
 * `/api/tournaments/:id/participants`) keep their exact behaviour.
 */

import { Router, type Request, type Response } from 'express';
import {
  getBracketDto,
  getGameLeaderboard,
  getMatchDetail,
  getMatchesDto,
  getParticipantsDto,
  getPlayerCompetitiveProfiles,
  getPlayerTournamentState,
  getPlayerTournaments,
  getTournamentSummary,
} from '../competitive/CompetitiveQueryService';
import {
  TeamError,
  assignPlayerToTeam,
  ensureTeamsInitialized,
  getPlayerTeam,
  getTeamsDto,
} from '../competitive/TeamService';
import { getTournamentById } from '../games/TournamentService';
import { getParticipant } from '../games/ParticipantService';
import { resolveSession } from '../auth/session';
import { findLinkedPlayerForUser } from '../identity/identityService';

export const tournamentCompetitiveRoutes = Router();

const ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

function badRequest(res: Response, error: string): void {
  res.status(400).json({ error });
}

function notFound(res: Response, error: string): void {
  res.status(404).json({ error });
}

const TEAM_STATUS: Record<string, number> = {
  tournament_not_found: 404,
  not_team_competition: 409,
  teams_locked: 409,
  tournament_not_open: 409,
  tournament_cancelled: 409,
  team_not_found: 404,
  team_full: 409,
  not_registered: 409,
  formation_not_choice: 409,
};

function sendTeamError(res: Response, err: unknown): void {
  if (err instanceof TeamError) {
    res.status(TEAM_STATUS[err.code] ?? 400).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[Tournaments] Unexpected team error:', err);
  res.status(500).json({ error: 'internal_error' });
}

/* ------------------------------- tournaments ------------------------------ */

tournamentCompetitiveRoutes.get('/tournaments/:tournamentId/summary', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  const summary = getTournamentSummary(tournamentId);
  if (!summary) return notFound(res, 'tournament_not_found');
  res.json({ tournament: summary });
});

tournamentCompetitiveRoutes.get('/tournaments/:tournamentId/bracket', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  const bracket = getBracketDto(tournamentId);
  if (!bracket) return notFound(res, 'tournament_not_found');
  res.json({ bracket });
});

tournamentCompetitiveRoutes.get('/tournaments/:tournamentId/matches', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  if (!getTournamentSummary(tournamentId)) return notFound(res, 'tournament_not_found');
  res.json({ matches: getMatchesDto(tournamentId) });
});

tournamentCompetitiveRoutes.get('/tournaments/:tournamentId/roster', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  if (!getTournamentSummary(tournamentId)) return notFound(res, 'tournament_not_found');
  res.json({ participants: getParticipantsDto(tournamentId) });
});

/* ----------------------------------- teams -------------------------------- */

/**
 * Roadmap #2 — public team read. Teams are materialized lazily for player-choice
 * tournaments (a read may initialize the empty team shells). No sensitive
 * internal fields are exposed; membership identity comes from the guest row.
 */
tournamentCompetitiveRoutes.get('/tournaments/:tournamentId/teams', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  const tournament = getTournamentById(tournamentId);
  if (!tournament) return notFound(res, 'tournament_not_found');
  if (tournament.competition_type === 'individual') {
    res.json({ teams: [], competitionType: 'individual' });
    return;
  }
  try {
    ensureTeamsInitialized(tournamentId);
  } catch (err) {
    sendTeamError(res, err);
    return;
  }

  // Session-aware hints (never trusted for authorization; the selection
  // endpoint re-validates everything).
  let playerTeamId: string | null = null;
  let canSelect = false;
  const user = resolveSession(req);
  if (user) {
    const linked = findLinkedPlayerForUser(user.id);
    if (linked) {
      playerTeamId = getPlayerTeam(tournamentId, linked.player_id)?.id ?? null;
      const participant = getParticipant(tournamentId, linked.player_id);
      canSelect =
        tournament.team_formation === 'player_choice' &&
        tournament.status === 'open' &&
        tournament.teams_locked_at === null &&
        !!participant &&
        (participant.status === 'registered' || participant.status === 'confirmed');
    }
  }

  res.json({
    teams: getTeamsDto(tournamentId),
    competitionType: tournament.competition_type,
    teamFormation: tournament.team_formation,
    teamsLockedAt: tournament.teams_locked_at,
    playerTeamId,
    canSelect,
  });
});

/**
 * Roadmap #2 — participant team selection. The player is ALWAYS derived from
 * the authenticated session → linked canonical player; the client can never
 * supply a player id. All capacity/lock/state rules are enforced server-side
 * inside `TeamService`.
 */
tournamentCompetitiveRoutes.post(
  '/tournaments/:tournamentId/team-selection',
  (req: Request, res: Response) => {
    const { tournamentId } = req.params;
    if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');

    const body = req.body as { teamId?: unknown } | undefined;
    if (!isId(body?.teamId)) return badRequest(res, 'invalid_team_id');

    const user = resolveSession(req);
    if (!user) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const linked = findLinkedPlayerForUser(user.id);
    if (!linked) {
      res.status(409).json({ error: 'account_not_linked', message: 'Link your account to a FalFoos Player first' });
      return;
    }

    try {
      const result = assignPlayerToTeam(tournamentId, linked.player_id, body.teamId, 'player');
      res.json({
        teams: getTeamsDto(tournamentId),
        playerTeamId: getPlayerTeam(tournamentId, linked.player_id)?.id ?? null,
        idempotent: result.idempotent,
        switched: result.switched,
      });
    } catch (err) {
      sendTeamError(res, err);
    }
  }
);

tournamentCompetitiveRoutes.get(
  '/tournaments/:tournamentId/players/:playerId',
  (req: Request, res: Response) => {
    const { tournamentId, playerId } = req.params;
    if (!isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
    if (!isId(playerId)) return badRequest(res, 'invalid_player_id');
    if (!getTournamentSummary(tournamentId)) return notFound(res, 'tournament_not_found');
    res.json({ state: getPlayerTournamentState(tournamentId, playerId) });
  }
);

/* --------------------------------- matches -------------------------------- */

tournamentCompetitiveRoutes.get('/matches/:matchId', (req: Request, res: Response) => {
  const { matchId } = req.params;
  if (!isId(matchId)) return badRequest(res, 'invalid_match_id');
  const detail = getMatchDetail(matchId);
  if (!detail) return notFound(res, 'match_not_found');
  res.json(detail);
});

/* ---------------------------------- games --------------------------------- */

tournamentCompetitiveRoutes.get('/games/:gameId/competitive', (req: Request, res: Response) => {
  const { gameId } = req.params;
  if (!isId(gameId)) return badRequest(res, 'invalid_game_id');
  const rawLimit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const leaderboard = getGameLeaderboard(gameId, rawLimit);
  if (!leaderboard) return notFound(res, 'game_not_found');
  res.json({ leaderboard });
});

/* --------------------------------- players -------------------------------- */

tournamentCompetitiveRoutes.get('/players/:playerId/tournaments', (req: Request, res: Response) => {
  const { playerId } = req.params;
  if (!isId(playerId)) return badRequest(res, 'invalid_player_id');
  const tournamentId = typeof req.query.tournamentId === 'string' ? req.query.tournamentId : undefined;
  if (tournamentId !== undefined && !isId(tournamentId)) return badRequest(res, 'invalid_tournament_id');
  res.json({ states: getPlayerTournaments(playerId, tournamentId) });
});

tournamentCompetitiveRoutes.get('/players/:playerId/competitive', (req: Request, res: Response) => {
  const { playerId } = req.params;
  if (!isId(playerId)) return badRequest(res, 'invalid_player_id');
  // `allGames=1` returns one entry per ACTIVE game, including games the player
  // has no competitive profile for (server-authoritative `unranked: true`).
  const allGames = req.query.allGames === '1' || req.query.allGames === 'true';
  res.json({ profiles: getPlayerCompetitiveProfiles(playerId, { allGames }) });
});
