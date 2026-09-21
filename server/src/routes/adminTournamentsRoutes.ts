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
  setTournamentHidden,
  type TournamentVisibility,
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

const VALID_VISIBILITIES: TournamentVisibility[] = ['visible', 'hidden', 'all'];

adminTournamentsRoutes.get('/', (req: Request, res: Response) => {
  try {
    // R5 — visibility filter. Defaults to `visible` so hidden tournaments are
    // excluded from the normal admin listing; `?visibility=hidden` powers the
    // dedicated "المخفية" view and `?visibility=all` shows everything.
    const raw = typeof req.query.visibility === 'string' ? req.query.visibility.trim() : '';
    if (raw && !VALID_VISIBILITIES.includes(raw as TournamentVisibility)) {
      res.status(400).json({ error: 'invalid_visibility' });
      return;
    }
    const visibility = (raw || 'visible') as TournamentVisibility;
    const tournaments = getTournamentsWithGameInfo({ visibility });
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
    const body = req.body as (UpdateTournamentInput & { hidden?: unknown }) | undefined;

    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid request body' });
      return;
    }

    if (!getTournamentById(req.params.id)) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }

    const hasHidden = Object.prototype.hasOwnProperty.call(body, 'hidden');
    if (hasHidden && typeof body.hidden !== 'boolean') {
      res.status(400).json({ error: 'invalid_hidden' });
      return;
    }

    // R5 — `hidden` is a VISIBILITY toggle handled separately from the
    // lifecycle fields. It never modifies `status`.
    const { hidden: _hidden, ...lifecycleFields } = body;
    let tournament = updateTournament(req.params.id, lifecycleFields as UpdateTournamentInput);

    if (hasHidden) {
      const user = resolveSession(req);
      const result = setTournamentHidden(req.params.id, body.hidden as boolean, user?.id ?? null);
      if (!result) {
        res.status(404).json({ error: 'Tournament not found' });
        return;
      }
      tournament = result.tournament;
    }

    res.json({ tournament });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Update tournament error:', err);
    res.status(400).json({ error: message });
  }
});

/**
 * R5 — BACKWARD-COMPATIBLE HIDE ALIAS.
 *
 * `DELETE` no longer deletes anything: it performs the same reversible,
 * non-destructive visibility hide as `PATCH { hidden: true }`. All tournament
 * data (participants, matches, corrections, ledgers, purchase intents, images)
 * is preserved. There is NO hard-delete path anywhere in the admin API.
 */
adminTournamentsRoutes.delete('/:id', (req: Request, res: Response) => {
  try {
    const user = resolveSession(req);
    const result = setTournamentHidden(req.params.id, true, user?.id ?? null);
    if (!result) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ tournament: result.tournament, hidden: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('[AdminTournaments] Hide tournament error:', err);
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