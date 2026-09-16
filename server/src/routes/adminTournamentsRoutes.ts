import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/requireAdmin';
import { resolveSession } from '../auth/session';
import {
  getAllTournaments,
  getTournamentsByGame,
  getTournamentsWithGameInfo,
  getTournamentById,
  getTournamentWithGameInfo,
  createTournament,
  updateTournament,
  deleteTournament,
  type TournamentRow,
  type TournamentWithGame,
  type CreateTournamentInput,
  type UpdateTournamentInput,
} from '../games/TournamentService';
import {
  getParticipantsByTournament,
  type ParticipantWithProfile,
} from '../games/ParticipantService';

export const adminTournamentsRoutes = Router();

adminTournamentsRoutes.use(requireAdmin);

adminTournamentsRoutes.get('/', (_req: Request, res: Response) => {
  try {
    const tournaments = getTournamentsWithGameInfo();
    res.json({ tournaments });
  } catch (err) {
    console.error('[AdminTournaments] List tournaments error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTournamentsRoutes.get('/:id', (req: Request, res: Response) => {
  try {
    const tournament = getTournamentWithGameInfo(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ tournament });
  } catch (err) {
    console.error('[AdminTournaments] Get tournament error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTournamentsRoutes.get('/:id/participants', (req: Request, res: Response) => {
  try {
    const tournament = getTournamentById(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    const participants = getParticipantsByTournament(req.params.id);
    res.json({ participants });
  } catch (err) {
    console.error('[AdminTournaments] Get participants error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

adminTournamentsRoutes.post('/', (req: Request, res: Response) => {
  try {
    const input = req.body as CreateTournamentInput;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const user = resolveSession(req);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const tournament = createTournament(input, user.id);
    res.status(201).json({ tournament });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Create tournament error:', err);
    res.status(400).json({ error: message });
  }
});

adminTournamentsRoutes.patch('/:id', (req: Request, res: Response) => {
  try {
    const input = req.body as UpdateTournamentInput;

    if (!input || typeof input !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    const tournament = updateTournament(req.params.id, input);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    res.json({ tournament });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Update tournament error:', err);
    res.status(400).json({ error: message });
  }
});

adminTournamentsRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteTournament(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Delete tournament error:', err);
    res.status(400).json({ error: message });
  }
});

adminTournamentsRoutes.post('/:id/participants', (req: Request, res: Response) => {
  try {
    const { player_id, source, ticket_ref } = req.body as {
      player_id: string;
      source: 'purchase' | 'admin' | 'qualifier';
      ticket_ref?: string;
    };

    if (!player_id || !source) {
      res.status(400).json({ error: 'player_id and source are required' });
      return;
    }

    const tournament = getTournamentById(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    // For admin manual registration, we can use the transactional function
    // but need to handle capacity and duplicate checks
    const { registerParticipantTransactional } = require('../games/ParticipantService');
    const result = registerParticipantTransactional(req.params.id, player_id, source, ticket_ref ?? null);

    if (!result.success) {
      const statusCode = result.error?.includes('full') ? 409 :
                         result.error?.includes('already registered') ? 409 : 400;
      res.status(statusCode).json({ error: result.error });
      return;
    }

    res.status(201).json({ participant: result.participant });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Add participant error:', err);
    res.status(400).json({ error: message });
  }
});