import { Router, type Request, type Response } from 'express';
import {
  getAllGames,
  getActiveGames,
  getGameById,
  getGameBySlug,
  type GameRow,
} from '../games/GameService';
import {
  getTournamentsByGame,
  getTournamentsWithGameInfo,
  getTournamentById,
  getTournamentWithGameInfo,
  type TournamentRow,
  type TournamentWithGame,
} from '../games/TournamentService';
import {
  getParticipantsByTournament,
  type ParticipantWithProfile,
} from '../games/ParticipantService';

export const gamesRoutes = Router();

// NOTE (Phase 4E fix): this router is mounted at `/api`, so the game-resource
// routes MUST carry an explicit `/games` prefix or they resolve to `/api` and
// `/api/:gameId`. The latter previously shadowed every other `/api/<x>` route
// (including the live game registry, `/api/health` and `/api/leaderboard`).
// Correct public paths: `/api/games`, `/api/games/:gameId`,
// `/api/games/:gameId/tournaments`; tournament routes stay at `/api/tournaments`.
gamesRoutes.get('/games', (_req: Request, res: Response) => {
  try {
    const games = getActiveGames();
    res.json({ games });
  } catch (err) {
    console.error('[GamesAPI] List games error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

gamesRoutes.get('/games/:gameId', (req: Request, res: Response) => {
  try {
    const game = getGameById(req.params.gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (!game.is_active) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json({ game });
  } catch (err) {
    console.error('[GamesAPI] Get game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

gamesRoutes.get('/games/:gameId/tournaments', (req: Request, res: Response) => {
  try {
    const game = getGameById(req.params.gameId);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    if (!game.is_active) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    const tournaments = getTournamentsByGame(req.params.gameId);
    res.json({ tournaments });
  } catch (err) {
    console.error('[GamesAPI] Get game tournaments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Tournaments endpoints
gamesRoutes.get('/tournaments', (req: Request, res: Response) => {
  try {
    // Phase 4D — optional, backward-compatible filters.
    const rawGameId = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : '';
    const rawStatus = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const validStatuses = ['draft', 'open', 'active', 'completed', 'cancelled'];
    if (rawStatus && !validStatuses.includes(rawStatus)) {
      res.status(400).json({ error: 'invalidStatus' });
      return;
    }

    let tournaments = getTournamentsWithGameInfo();
    if (rawGameId) tournaments = tournaments.filter((t) => t.game_id === rawGameId);
    if (rawStatus) tournaments = tournaments.filter((t) => t.status === rawStatus);
    res.json({ tournaments });
  } catch (err) {
    console.error('[GamesAPI] List tournaments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

gamesRoutes.get('/tournaments/:tournamentId', (req: Request, res: Response) => {
  try {
    const tournament = getTournamentWithGameInfo(req.params.tournamentId);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ tournament });
  } catch (err) {
    console.error('[GamesAPI] Get tournament error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

gamesRoutes.get('/tournaments/:tournamentId/participants', (req: Request, res: Response) => {
  try {
    const tournament = getTournamentById(req.params.tournamentId);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    const participants = getParticipantsByTournament(req.params.tournamentId);
    res.json({ participants });
  } catch (err) {
    console.error('[GamesAPI] Get participants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});