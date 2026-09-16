/**
 * Phase 4D — admin tournament/competitive routes.
 *
 * Mounted at `/api/admin/tournaments` (stacked after the existing admin
 * tournament router so only the new sub-paths are handled here).
 *
 * Every mutating operation requires the existing `requireAdmin` session check
 * and delegates to the Phase 4C services — the HTTP layer never calculates LP,
 * Elo, advancement, bracket generation or champion selection, and never writes
 * competitive state directly.
 */

import { Router, type Request, type Response } from 'express';
import { requireAdmin } from '../middleware/requireAdmin';
import { resolveSession } from '../auth/session';
import { BracketError, generateBracket } from '../competitive/BracketService';
import {
  TournamentMatchError,
  cancelMatch,
  getMatch,
  getTournamentMatches,
  openDispute,
  recordMatchResult,
  resolveDispute,
  setMatchStatus,
  startMatch,
  type MatchResultSource,
  type RecordMatchResultOutcome,
  type TournamentMatchStatus,
} from '../competitive/TournamentMatchService';
import {
  MatchCorrectionError,
  correctMatchResult,
  type CorrectMatchResultOutcome,
} from '../competitive/MatchCorrectionService';
import {
  getBracketDto,
  getMatchDetail,
  getMatchesDto,
  getTournamentSummary,
} from '../competitive/CompetitiveQueryService';

export const adminTournamentCompetitiveRoutes = Router();

adminTournamentCompetitiveRoutes.use(requireAdmin);

const ID_RE = /^[A-Za-z0-9:_-]{1,80}$/;
const RESULT_SOURCES: MatchResultSource[] = ['admin', 'auto', 'import'];
const STATUS_BODY_VALUES = ['scheduled', 'active', 'cancelled', 'disputed'] as const;

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

const BRACKET_STATUS: Record<string, number> = {
  tournament_not_found: 404,
  already_generated: 409,
  invalid_tournament_state: 409,
  not_enough_participants: 400,
  bad_rng: 500,
  bad_bracket: 500,
};

const MATCH_STATUS: Record<string, number> = {
  match_not_found: 404,
  tournament_not_found: 404,
  match_already_completed: 409,
  match_disputed: 409,
  match_cancelled: 409,
  tournament_not_active: 409,
  invalid_transition: 409,
  winner_not_participant: 400,
  match_not_ready: 409,
  participant_not_registered: 409,
  correction_deferred: 409,
  game_mismatch: 409,
  match_not_playable: 409,
  invalid_match: 409,
  bad_graph: 500,
};

const CORRECTION_STATUS: Record<string, number> = {
  match_not_found: 404,
  tournament_not_found: 404,
  match_not_completed: 409,
  not_two_participants: 409,
  invalid_corrected_winner: 400,
  missing_reason: 400,
  duplicate_correction: 409,
  downstream_conflict: 409,
  downstream_in_progress: 409,
  invalid_match: 409,
};

function sendServiceError(res: Response, err: unknown): void {
  if (err instanceof BracketError) {
    res.status(BRACKET_STATUS[err.code] ?? 400).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof TournamentMatchError) {
    res.status(MATCH_STATUS[err.code] ?? 400).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof MatchCorrectionError) {
    res.status(CORRECTION_STATUS[err.code] ?? 400).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[AdminTournamentCompetitive] Unexpected error:', err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Resolves a match and asserts it belongs to the route's tournament. */
function loadScopedMatch(
  tournamentId: string,
  matchId: string,
  res: Response
): ReturnType<typeof getMatch> | null {
  const match = getMatch(matchId);
  if (!match || match.tournament_id !== tournamentId) {
    res.status(404).json({ error: 'match_not_found' });
    return null;
  }
  return match;
}

function toResultDto(outcome: RecordMatchResultOutcome) {
  return {
    winnerPlayerId: outcome.winnerPlayerId,
    loserPlayerId: outcome.loserPlayerId,
    advanced: outcome.advanced,
    nextMatchId: outcome.nextMatchId,
    nextMatchSlot: outcome.nextMatchSlot,
    tournamentCompleted: outcome.tournamentCompleted,
    championPlayerId: outcome.championPlayerId,
    alreadyProcessed: outcome.alreadyProcessed,
    match: {
      id: outcome.match.id,
      status: outcome.match.status,
      winnerPlayerId: outcome.match.winner_player_id,
      completedAt: outcome.match.completed_at,
    },
  };
}

/* --------------------------------- bracket -------------------------------- */

adminTournamentCompetitiveRoutes.post('/:tournamentId/bracket', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) {
    res.status(400).json({ error: 'invalid_tournament_id' });
    return;
  }
  try {
    // Client cannot provide seeds or override the bracket.
    const generation = generateBracket(tournamentId);
    res.status(201).json({ generation, bracket: getBracketDto(tournamentId) });
  } catch (err) {
    sendServiceError(res, err);
  }
});

adminTournamentCompetitiveRoutes.get('/:tournamentId/bracket', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) {
    res.status(400).json({ error: 'invalid_tournament_id' });
    return;
  }
  const bracket = getBracketDto(tournamentId);
  if (!bracket) {
    res.status(404).json({ error: 'tournament_not_found' });
    return;
  }
  res.json({ bracket });
});

/* ---------------------------------- state --------------------------------- */

adminTournamentCompetitiveRoutes.get('/:tournamentId/state', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) {
    res.status(400).json({ error: 'invalid_tournament_id' });
    return;
  }
  const summary = getTournamentSummary(tournamentId);
  if (!summary) {
    res.status(404).json({ error: 'tournament_not_found' });
    return;
  }
  res.json({ tournament: summary, matches: getMatchesDto(tournamentId) });
});

/* --------------------------------- matches -------------------------------- */

adminTournamentCompetitiveRoutes.get('/:tournamentId/matches', (req: Request, res: Response) => {
  const { tournamentId } = req.params;
  if (!isId(tournamentId)) {
    res.status(400).json({ error: 'invalid_tournament_id' });
    return;
  }
  if (!getTournamentSummary(tournamentId)) {
    res.status(404).json({ error: 'tournament_not_found' });
    return;
  }
  res.json({ matches: getMatchesDto(tournamentId) });
});

adminTournamentCompetitiveRoutes.get('/:tournamentId/matches/:matchId', (req: Request, res: Response) => {
  const { tournamentId, matchId } = req.params;
  if (!isId(tournamentId) || !isId(matchId)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  if (!loadScopedMatch(tournamentId, matchId, res)) return;
  res.json(getMatchDetail(matchId));
});

/* ------------------------------- record result ---------------------------- */

adminTournamentCompetitiveRoutes.post(
  '/:tournamentId/matches/:matchId/result',
  (req: Request, res: Response) => {
    const { tournamentId, matchId } = req.params;
    if (!isId(tournamentId) || !isId(matchId)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    if (!loadScopedMatch(tournamentId, matchId, res)) return;

    const body = req.body as {
      winnerPlayerId?: unknown;
      resultSource?: unknown;
      idempotencyKey?: unknown;
    };

    if (!isId(body?.winnerPlayerId)) {
      res.status(400).json({ error: 'invalid_winner_player_id' });
      return;
    }
    if (body.resultSource !== undefined && !RESULT_SOURCES.includes(body.resultSource as MatchResultSource)) {
      res.status(400).json({ error: 'invalid_result_source' });
      return;
    }
    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0)) {
      res.status(400).json({ error: 'invalid_idempotency_key' });
      return;
    }

    try {
      const outcome = recordMatchResult({
        matchId,
        winnerPlayerId: body.winnerPlayerId,
        resultSource: (body.resultSource as MatchResultSource) ?? 'admin',
        idempotencyKey: body.idempotencyKey as string | undefined,
      });
      res.json({ result: toResultDto(outcome) });
    } catch (err) {
      sendServiceError(res, err);
    }
  }
);

/* ------------------------------ correct result ---------------------------- */

function toCorrectionDto(outcome: CorrectMatchResultOutcome) {
  return {
    matchId: outcome.match.id,
    tournamentId: outcome.match.tournament_id,
    gameId: outcome.match.game_id,
    status: outcome.match.status,
    previousWinnerPlayerId: outcome.previousWinnerPlayerId,
    correctedWinnerPlayerId: outcome.correctedWinnerPlayerId,
    changed: outcome.changed,
    alreadyProcessed: outcome.alreadyProcessed,
    tournamentCompleted: outcome.tournamentCompleted,
    championPlayerId: outcome.championPlayerId,
    affectedPlayerIds: outcome.affectedPlayerIds,
  };
}

adminTournamentCompetitiveRoutes.patch(
  '/:tournamentId/matches/:matchId/result',
  (req: Request, res: Response) => {
    const { tournamentId, matchId } = req.params;
    if (!isId(tournamentId) || !isId(matchId)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    if (!loadScopedMatch(tournamentId, matchId, res)) return;

    const body = req.body as {
      correctedWinnerPlayerId?: unknown;
      reason?: unknown;
      idempotencyKey?: unknown;
    };

    const rawWinner = body?.correctedWinnerPlayerId;
    if (rawWinner !== undefined && rawWinner !== null && !isId(rawWinner)) {
      res.status(400).json({ error: 'invalid_corrected_winner' });
      return;
    }
    if (typeof body?.reason !== 'string' || body.reason.trim().length === 0) {
      res.status(400).json({ error: 'missing_reason' });
      return;
    }
    if (
      body.idempotencyKey !== undefined &&
      (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0)
    ) {
      res.status(400).json({ error: 'invalid_idempotency_key' });
      return;
    }

    try {
      const outcome = correctMatchResult({
        matchId,
        correctedWinnerPlayerId: (rawWinner as string | null | undefined) ?? null,
        reason: body.reason,
        actorId: resolveSession(req)?.id ?? null,
        idempotencyKey: body.idempotencyKey as string | undefined,
      });
      res.json({ correction: toCorrectionDto(outcome) });
    } catch (err) {
      sendServiceError(res, err);
    }
  }
);

/* ------------------------------ match lifecycle --------------------------- */

adminTournamentCompetitiveRoutes.patch(
  '/:tournamentId/matches/:matchId/status',
  (req: Request, res: Response) => {
    const { tournamentId, matchId } = req.params;
    if (!isId(tournamentId) || !isId(matchId)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    if (!loadScopedMatch(tournamentId, matchId, res)) return;

    const status = (req.body as { status?: unknown })?.status;
    if (typeof status !== 'string' || !STATUS_BODY_VALUES.includes(status as (typeof STATUS_BODY_VALUES)[number])) {
      // `completed` is intentionally rejected: results must go through the
      // result endpoint so the competitive effects are applied atomically.
      res.status(400).json({ error: 'invalid_status' });
      return;
    }

    try {
      let match;
      switch (status) {
        case 'scheduled':
          match = setMatchStatus(matchId, 'scheduled' as TournamentMatchStatus);
          break;
        case 'active':
          match = startMatch(matchId);
          break;
        case 'cancelled':
          match = cancelMatch(matchId);
          break;
        case 'disputed':
          match = openDispute(matchId);
          break;
        default:
          res.status(400).json({ error: 'invalid_status' });
          return;
      }
      res.json({ match: getMatchDetail(match.id)?.match ?? null });
    } catch (err) {
      sendServiceError(res, err);
    }
  }
);

/* --------------------------------- disputes ------------------------------- */

adminTournamentCompetitiveRoutes.post(
  '/:tournamentId/matches/:matchId/dispute',
  (req: Request, res: Response) => {
    const { tournamentId, matchId } = req.params;
    if (!isId(tournamentId) || !isId(matchId)) {
      res.status(400).json({ error: 'invalid_id' });
      return;
    }
    if (!loadScopedMatch(tournamentId, matchId, res)) return;

    const body = req.body as { action?: unknown; resolution?: unknown };
    try {
      if (body?.action === 'open') {
        const match = openDispute(matchId);
        res.json({ match: getMatchDetail(match.id)?.match ?? null });
        return;
      }
      if (body?.action === 'resolve') {
        if (body.resolution !== 'completed' && body.resolution !== 'cancelled') {
          res.status(400).json({ error: 'invalid_resolution' });
          return;
        }
        const match = resolveDispute(matchId, body.resolution);
        res.json({ match: getMatchDetail(match.id)?.match ?? null });
        return;
      }
      res.status(400).json({ error: 'invalid_action' });
    } catch (err) {
      sendServiceError(res, err);
    }
  }
);
