/**
 * Phase 4C — TournamentMatchService.
 *
 * Owns the tournament match lifecycle and the atomic result transaction that
 * connects a completed match to winner advancement, LP, Elo and W/L/D stats.
 *
 * State machine (validated here, `pending` is the initial state):
 *   pending   → scheduled | active | cancelled
 *   scheduled → active | cancelled
 *   active    → cancelled
 *   completed → disputed
 *   disputed  → completed
 *   cancelled → (terminal)
 *
 * `completed` is only ever reached through `recordMatchResult` (which applies
 * the competitive effects); `setMatchStatus` cannot set it directly.
 *
 * Result processing is idempotent via `tournament_matches.result_idempotency_key`
 * (`match:<matchId>:result` by default) and is fully atomic: match update,
 * winner advancement, LP, Elo, stats and tournament completion commit together
 * or not at all. The Phase 4B services open savepoints, so their ledger + profile
 * writes participate in this outer transaction.
 *
 * Correction/deferral note: reversing the competitive effects of an already
 * completed match (disputed → cancelled) is intentionally NOT implemented in
 * Phase 4C — doing so safely requires a dedicated correction architecture
 * (downstream reversal). `resolveDispute(..., 'cancelled')` therefore rejects
 * with `correction_deferred` instead of corrupting state. Dispute state changes
 * never destroy audit history.
 */

import { getDb } from '../db/db';
import { getTournamentById, updateTournament, type TournamentRow } from '../games/TournamentService';
import { applyLpResult } from './LpService';
import { applyEloResult } from './EloService';
import { awardMatchXp } from './GlobalProgressionService';
import { applyResultStats, getOrCreateProfile } from './CompetitiveProfileService';
import { emitCompetitiveEvent } from './competitiveEvents';
import type { CompetitiveResult } from './types';

export type TournamentMatchStatus =
  | 'pending'
  | 'scheduled'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export type MatchResultSource = 'admin' | 'auto' | 'import';

export class TournamentMatchError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TournamentMatchError';
  }
}

export interface TournamentMatchRow {
  id: string;
  tournament_id: string;
  game_id: string;
  round_no: number;
  slot_no: number;
  status: TournamentMatchStatus;
  best_of: number | null;
  winner_player_id: string | null;
  next_match_id: string | null;
  next_match_slot: number | null;
  scheduled_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result_source: MatchResultSource | null;
  result_idempotency_key: string | null;
  created_at: number;
  updated_at: number;
}

export interface MatchParticipantRow {
  match_id: string;
  player_id: string;
  slot: number;
  seed: number | null;
}

export interface RecordMatchResultInput {
  matchId: string;
  winnerPlayerId: string;
  resultSource?: MatchResultSource;
  /** Defaults to `match:<matchId>:result`. */
  idempotencyKey?: string;
}

export interface RecordMatchResultOutcome {
  match: TournamentMatchRow;
  winnerPlayerId: string;
  loserPlayerId: string | null;
  advanced: boolean;
  nextMatchId: string | null;
  nextMatchSlot: number | null;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  alreadyProcessed: boolean;
}

/**
 * Transitions allowed via `setMatchStatus`. `completed` is deliberately absent:
 * it is only reachable through `recordMatchResult`.
 */
const STATUS_TRANSITIONS: Record<TournamentMatchStatus, TournamentMatchStatus[]> = {
  pending: ['scheduled', 'active', 'cancelled'],
  scheduled: ['active', 'cancelled'],
  active: ['cancelled'],
  completed: ['disputed'],
  disputed: ['completed'],
  cancelled: [],
};

export function getMatch(matchId: string): TournamentMatchRow | null {
  const row = getDb().prepare('SELECT * FROM tournament_matches WHERE id = ?').get(matchId) as
    | TournamentMatchRow
    | undefined;
  return row ?? null;
}

export function getMatchParticipants(matchId: string): MatchParticipantRow[] {
  return getDb()
    .prepare(
      'SELECT match_id, player_id, slot, seed FROM tournament_match_participants WHERE match_id = ? ORDER BY slot ASC'
    )
    .all(matchId) as MatchParticipantRow[];
}

export function getTournamentMatches(tournamentId: string): TournamentMatchRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_no ASC, slot_no ASC'
    )
    .all(tournamentId) as TournamentMatchRow[];
}

/** The champion is the winner of the completed final (final has no next match). */
export function getTournamentChampion(tournamentId: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT winner_player_id FROM tournament_matches
        WHERE tournament_id = ? AND next_match_id IS NULL AND status = 'completed'
        LIMIT 1`
    )
    .get(tournamentId) as { winner_player_id: string | null } | undefined;
  return row?.winner_player_id ?? null;
}

function requireMatch(matchId: string): TournamentMatchRow {
  const match = getMatch(matchId);
  if (!match) {
    throw new TournamentMatchError('match_not_found', `unknown match "${matchId}"`);
  }
  return match;
}

/** Explicit state transition (admin primitives). Rejects invalid transitions. */
export function setMatchStatus(matchId: string, nextStatus: TournamentMatchStatus): TournamentMatchRow {
  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): TournamentMatchRow => {
    const match = requireMatch(matchId);
    const allowed = STATUS_TRANSITIONS[match.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new TournamentMatchError(
        'invalid_transition',
        `cannot move match from "${match.status}" to "${nextStatus}"`
      );
    }

    const startedAt =
      nextStatus === 'active' && match.started_at === null ? now : match.started_at;
    const scheduledAt =
      nextStatus === 'scheduled' && match.scheduled_at === null ? now : match.scheduled_at;

    db.prepare(
      'UPDATE tournament_matches SET status = ?, started_at = ?, scheduled_at = ?, updated_at = ? WHERE id = ?'
    ).run(nextStatus, startedAt, scheduledAt, now, matchId);

    return requireMatch(matchId);
  });

  const updatedMatch = tx();
  // Post-commit invalidation signal (transport-agnostic; wired to Socket.IO at
  // the server edge). Never emitted when the transaction rolls back.
  emitCompetitiveEvent({
    type: 'match.updated',
    tournamentId: updatedMatch.tournament_id,
    gameId: updatedMatch.game_id,
    matchId: updatedMatch.id,
  });
  return updatedMatch;
}

/** Marks a match active (from pending or scheduled). */
export function startMatch(matchId: string): TournamentMatchRow {
  const match = requireMatch(matchId);
  if (match.status === 'pending') {
    // pending → scheduled → active in one call, both valid transitions.
    setMatchStatus(matchId, 'scheduled');
  }
  return setMatchStatus(matchId, 'active');
}

/** Cancels a match that has not been completed (no competitive effects exist). */
export function cancelMatch(matchId: string): TournamentMatchRow {
  const match = requireMatch(matchId);
  if (match.status === 'completed' || match.status === 'disputed') {
    throw new TournamentMatchError(
      'cannot_cancel',
      'a completed/disputed match cannot be cancelled in Phase 4C (correction deferred)'
    );
  }
  return setMatchStatus(matchId, 'cancelled');
}

/** Opens a dispute on a completed match. */
export function openDispute(matchId: string): TournamentMatchRow {
  return setMatchStatus(matchId, 'disputed');
}

/**
 * Resolves a dispute. `completed` reaffirms the existing result. `cancelled`
 * would require reversing applied competitive effects, which is deliberately
 * deferred, so it is rejected with `correction_deferred`.
 */
export function resolveDispute(
  matchId: string,
  resolution: 'completed' | 'cancelled'
): TournamentMatchRow {
  if (resolution === 'cancelled') {
    throw new TournamentMatchError(
      'correction_deferred',
      'reversing applied competitive effects is not supported in Phase 4C'
    );
  }
  return setMatchStatus(matchId, 'completed');
}

function buildReplayOutcome(
  match: TournamentMatchRow,
  tournament: TournamentRow
): RecordMatchResultOutcome {
  const participants = getMatchParticipants(match.id);
  const loser = participants.find((p) => p.player_id !== match.winner_player_id)?.player_id ?? null;
  const isFinal = match.next_match_id === null;
  return {
    match,
    winnerPlayerId: match.winner_player_id!,
    loserPlayerId: loser,
    advanced: !isFinal,
    nextMatchId: match.next_match_id,
    nextMatchSlot: match.next_match_slot,
    tournamentCompleted: isFinal && tournament.status === 'completed',
    championPlayerId: isFinal ? match.winner_player_id : null,
    alreadyProcessed: true,
  };
}

/**
 * Records the result of a played match and applies every competitive effect in
 * ONE atomic transaction.
 */
export function recordMatchResult(input: RecordMatchResultInput): RecordMatchResultOutcome {
  const db = getDb();
  const now = Date.now();
  const idempotencyKey = input.idempotencyKey ?? `match:${input.matchId}:result`;
  const resultSource: MatchResultSource = input.resultSource ?? 'admin';

  const tx = db.transaction((): RecordMatchResultOutcome => {
    const match = requireMatch(input.matchId);
    const tournament = getTournamentById(match.tournament_id);
    if (!tournament) {
      throw new TournamentMatchError('tournament_not_found', 'tournament for match not found');
    }

    // Idempotent replay: same key on an already-completed match.
    if (match.status === 'completed') {
      if (match.result_idempotency_key === idempotencyKey) {
        return buildReplayOutcome(match, tournament);
      }
      throw new TournamentMatchError(
        'match_already_completed',
        'match already has a recorded result'
      );
    }
    if (match.status === 'disputed') {
      throw new TournamentMatchError('match_disputed', 'resolve the dispute before recording a result');
    }
    if (match.status === 'cancelled') {
      throw new TournamentMatchError('match_cancelled', 'cannot record a result for a cancelled match');
    }
    if (tournament.status !== 'active') {
      throw new TournamentMatchError(
        'tournament_not_active',
        `tournament must be active (got "${tournament.status}")`
      );
    }
    if (match.game_id !== tournament.game_id) {
      throw new TournamentMatchError('game_mismatch', 'match game does not match tournament game');
    }

    const participants = getMatchParticipants(match.id);
    if (participants.length !== 2) {
      throw new TournamentMatchError(
        'match_not_ready',
        `match needs exactly two known participants (got ${participants.length})`
      );
    }
    const winner = participants.find((p) => p.player_id === input.winnerPlayerId);
    if (!winner) {
      throw new TournamentMatchError('winner_not_participant', 'winner is not a match participant');
    }
    const loser = participants.find((p) => p.player_id !== winner.player_id);
    if (!loser) {
      throw new TournamentMatchError('invalid_match', 'match has no opponent');
    }

    // Participants must be registered in the same tournament.
    const isRegistered = db.prepare(
      `SELECT 1 AS ok FROM tournament_participants
        WHERE tournament_id = ? AND player_id = ? AND status IN ('registered','confirmed')`
    );
    for (const participant of [winner, loser]) {
      if (!isRegistered.get(match.tournament_id, participant.player_id)) {
        throw new TournamentMatchError(
          'participant_not_registered',
          `player "${participant.player_id}" is not a registered participant`
        );
      }
    }

    // Capture pre-match Elo for a mathematically consistent exchange.
    const winnerEloBefore = getOrCreateProfile(winner.player_id, match.game_id).elo;
    const loserEloBefore = getOrCreateProfile(loser.player_id, match.game_id).elo;

    // Complete the match (guarded so a concurrent completion cannot double-apply).
    const updated = db.prepare(
      `UPDATE tournament_matches
          SET status = 'completed', winner_player_id = ?, completed_at = ?, updated_at = ?,
              result_source = ?, result_idempotency_key = ?
        WHERE id = ? AND status IN ('pending','scheduled','active')`
    ).run(winner.player_id, now, now, resultSource, idempotencyKey, match.id);
    if (updated.changes !== 1) {
      throw new TournamentMatchError('match_not_playable', 'match is no longer playable');
    }

    // Winner advances to the explicit next-match slot; the loser does not.
    let nextMatchId: string | null = null;
    let nextMatchSlot: number | null = null;
    if (match.next_match_id) {
      nextMatchId = match.next_match_id;
      nextMatchSlot = match.next_match_slot;
      if (nextMatchSlot !== 1 && nextMatchSlot !== 2) {
        throw new TournamentMatchError('bad_graph', 'next match slot is missing');
      }
      db.prepare(
        `INSERT INTO tournament_match_participants (match_id, player_id, slot, seed, created_at)
         VALUES (?, ?, ?, NULL, ?)`
      ).run(nextMatchId, winner.player_id, nextMatchSlot, now);
    }

    // LP — winner +25, loser -20, exactly once via deterministic keys.
    applyLpResult({
      playerId: winner.player_id,
      gameId: match.game_id,
      result: 'win',
      sourceType: 'match',
      sourceId: match.id,
      matchId: match.id,
      tournamentId: match.tournament_id,
      idempotencyKey: `match:${match.id}:${winner.player_id}:lp`,
    });
    applyLpResult({
      playerId: loser.player_id,
      gameId: match.game_id,
      result: 'loss',
      sourceType: 'match',
      sourceId: match.id,
      matchId: match.id,
      tournamentId: match.tournament_id,
      idempotencyKey: `match:${match.id}:${loser.player_id}:lp`,
    });

    // Elo — Phase 4A engine, both sides zero-sum against pre-match ratings.
    applyEloResult({
      playerId: winner.player_id,
      gameId: match.game_id,
      opponentRating: loserEloBefore,
      result: 'win',
      sourceId: match.id,
      matchId: match.id,
      idempotencyKey: `match:${match.id}:${winner.player_id}:elo`,
    });
    applyEloResult({
      playerId: loser.player_id,
      gameId: match.game_id,
      opponentRating: winnerEloBefore,
      result: 'loss',
      sourceId: match.id,
      matchId: match.id,
      idempotencyKey: `match:${match.id}:${loser.player_id}:elo`,
    });

    // W/L/D stats (byes and cancellations never reach here).
    applyResultStats(winner.player_id, match.game_id, 'win');
    applyResultStats(loser.player_id, match.game_id, 'loss');

    // Global Competitive XP (Model C: match + result) — GLOBAL across games,
    // independent of LP/Elo/rank, awarded exactly once per player/match inside
    // this same transaction (the idempotency key is the duplicate guard).
    awardMatchXp({
      playerId: winner.player_id,
      matchId: match.id,
      tournamentId: match.tournament_id,
      gameId: match.game_id,
      result: 'win',
      idempotencyKey: `match:${match.id}:${winner.player_id}:xp`,
    });
    awardMatchXp({
      playerId: loser.player_id,
      matchId: match.id,
      tournamentId: match.tournament_id,
      gameId: match.game_id,
      result: 'loss',
      idempotencyKey: `match:${match.id}:${loser.player_id}:xp`,
    });

    // Final match → completed tournament. The champion is the final's winner.
    let tournamentCompleted = false;
    let championPlayerId: string | null = null;
    if (match.next_match_id === null) {
      championPlayerId = winner.player_id;
      updateTournament(match.tournament_id, { status: 'completed' });
      tournamentCompleted = true;
    }

    const finalMatch = requireMatch(match.id);
    return {
      match: finalMatch,
      winnerPlayerId: winner.player_id,
      loserPlayerId: loser.player_id,
      advanced: nextMatchId !== null,
      nextMatchId,
      nextMatchSlot,
      tournamentCompleted,
      championPlayerId,
      alreadyProcessed: false,
    };
  });

  const outcome = tx();

  // Events strictly AFTER commit. A replay/idempotent call publishes nothing.
  if (!outcome.alreadyProcessed) {
    const tournamentId = outcome.match.tournament_id;
    const gameId = outcome.match.game_id;
    emitCompetitiveEvent({ type: 'match.updated', tournamentId, gameId, matchId: outcome.match.id });
    emitCompetitiveEvent({ type: 'tournament.updated', tournamentId, gameId });
    if (outcome.advanced) {
      emitCompetitiveEvent({ type: 'bracket.updated', tournamentId, gameId });
    }
    if (outcome.tournamentCompleted) {
      emitCompetitiveEvent({
        type: 'tournament.completed',
        tournamentId,
        gameId,
        championPlayerId: outcome.championPlayerId,
      });
    }
    if (outcome.winnerPlayerId) {
      emitCompetitiveEvent({ type: 'competitive_profile.updated', gameId, playerId: outcome.winnerPlayerId });
    }
    if (outcome.loserPlayerId) {
      emitCompetitiveEvent({ type: 'competitive_profile.updated', gameId, playerId: outcome.loserPlayerId });
    }
  }

  return outcome;
}
