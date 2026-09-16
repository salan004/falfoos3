import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/requireAdmin';
import {
  getAllGames,
  getGameById,
  getGameBySlug,
  createGame,
  updateGame,
  deactivateGame,
  type GameRow,
  type CreateGameInput,
  type UpdateGameInput,
} from '../games/GameService';

export const adminGamesRoutes = Router();

adminGamesRoutes.use(requireAdmin);

adminGamesRoutes.get('/', (_req: Request, res: Response) => {
  try {
    const games = getAllGames();
    res.json({ games });
  } catch (err) {
    console.error('[AdminGames] List games error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminGamesRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const game = getGameById(req.params.id);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json({ game });
  } catch (err) {
    console.error('[AdminGames] Get game error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminGamesRoutes.post('/', (req: Request, res: Response) => {
  try {
    const input = req.body as CreateGameInput;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const game = createGame(input);
    res.status(201).json({ game });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminGames] Create game error:', err);
    res.status(400).json({ error: message });
  }
});

adminGamesRoutes.patch('/:id', (req: Request, res: Response) => {
  try {
    const input = req.body as UpdateGameInput;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const game = updateGame(req.params.id, input);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json({ game });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminGames] Update game error:', err);
    res.status(400).json({ error: message });
  }
});

adminGamesRoutes.post('/:id/deactivate', (req: Request, res: Response) => {
  try {
    const game = deactivateGame(req.params.id);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }
    res.json({ game });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminGames] Deactivate game error:', err);
    res.status(400).json({ error: message });
  }
});