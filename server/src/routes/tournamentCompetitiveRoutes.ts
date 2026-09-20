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
