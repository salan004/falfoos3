/**
 * Phase 4F — MatchCorrectionService.
 *
 * Secure, atomic, idempotent correction of an already-completed tournament
 * match result. This is deliberately separate from `recordMatchResult`
 * (which records a *first* result): correction only ever runs against a
 * `completed` match and reconciles LP, Elo, W/L/D, bracket advancement and the
 * tournament champion.
 *
 * Design:
 * - Immutable ledgers: the original LP/Elo rows are never edited. Correction
 *   writes compensating `reversal` rows (negating the match's current net
 *   effect) followed by `correction` rows for the new result. The authoritative
 *   materialized profile is then rebuilt deterministically from the ledger
 *   (`CompetitiveRebuildService`), so LP/Elo/stats can always be reconstructed.
 * - Elo is recomputed against the match's *historical* pre-match ratings
 *   (the earliest ledger row per player), keeping it deterministic and
 *   zero-sum regardless of other matches played in between.
 * - Bracket safety: a corrected winner is written into the pending downstream
 *   match; if that downstream match is already completed/disputed or has begun
 *   (scheduled/active), the correction is rejected rather than corrupting
 *   history. A draw leaves the downstream slot empty (requires admin action).
 * - Idempotency + audit: one immutable `match_result_corrections` row keyed by
 *   `idempotency_key` (UNIQUE). Replaying the same correction is a no-op.
 * - Events are published only after the transaction commits.
 */

import { getDb } from '../db/db';
import { getTournamentById, updateTournament } from '../games/TournamentService';
import { applyLpDelta, applyLpResult } from './LpService';
import { applyEloDelta } from './EloService';
import { computeElo } from './eloEngine';
import { getOrCreateProfile } from './CompetitiveProfileService';
import { rebuildProfile } from './CompetitiveRebuildService';
import {
  getMatch,
  getMatchParticipants,
  getTournamentChampion,
  type TournamentMatchRow,
} from './TournamentMatchService';
import { emitCompetitiveEvent } from './competitiveEvents';
import type { CompetitiveResult } from './types';

export type CorrectionResultKind = 'win' | 'draw';

export class MatchCorrectionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MatchCorrectionError';
  }
}

export interface CorrectMatchResultInput {
  matchId: string;
  /** null means the corrected outcome is a draw. */
  correctedWinnerPlayerId: string | null;
  reason: string;
  /** Actor (admin user id) if available; stored in the audit row. */
  actorId?: string | null;
  /** Defaults to `correction:<matchId>:<winnerOrDraw>`. */
  idempotencyKey?: string;
}

export interface CorrectMatchResultOutcome {
  match: TournamentMatchRow;
  previousWinnerPlayerId: string | null;
  correctedWinnerPlayerId: string | null;
  changed: boolean;
  alreadyProcessed: boolean;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  affectedPlayerIds: string[];
}

interface CorrectionAuditRow {
  match_id: string;
  corrected_winner_player_id: string | null;
}

function resultFor(winnerId: string | null, playerId: string): CompetitiveResult {
  if (winnerId === null) return 'draw';
  return winnerId === playerId ? 'win' : 'loss';
}

function kindOf(winnerId: string | null): CorrectionResultKind {
  return winnerId === null ? 'draw' : 'win';
}

/** Earliest recorded pre-match rating for a player in a match. */
function preMatchRating(matchId: string, playerId: string): number | null {
  const row = getDb()
    .prepare(
      `SELECT rating_before FROM elo_transactions
        WHERE match_id = ? AND player_id = ?
        ORDER BY id ASC LIMIT 1`
    )
    .get(matchId, playerId) as { rating_before: number } | undefined;
  return row?.rating_before ?? null;
}

function currentMatchLpNet(matchId: string, playerId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS net FROM lp_transactions WHERE match_id = ? AND player_id = ?'
    )
    .get(matchId, playerId) as { net: number };
  return row.net;
}

function currentMatchEloNet(matchId: string, playerId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(delta), 0) AS net FROM elo_transactions WHERE match_id = ? AND player_id = ?'
    )
    .get(matchId, playerId) as { net: number };
  return row.net;
}

function buildOutcome(
  match: TournamentMatchRow,
  previousWinner: string | null,
  correctedWinner: string | null,
  alreadyProcessed: boolean,
  champion: string | null
): CorrectMatchResultOutcome {
  return {
    match,
    previousWinnerPlayerId: previousWinner,
    correctedWinnerPlayerId: correctedWinner,
    changed: previousWinner !== correctedWinner && !alreadyProcessed,
    alreadyProcessed,
    tournamentCompleted: match.next_match_id === null && correctedWinner !== null,
    championPlayerId: champion,
    affectedPlayerIds: getMatchParticipants(match.id).map((p) => p.player_id),
  };
}

/**
 * Corrects a completed match result. Fully atomic and idempotent.
 */
export function correctMatchResult(input: CorrectMatchResultInput): CorrectMatchResultOutcome {
  const db = getDb();
  const now = Date.now();
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length === 0) {
    throw new MatchCorrectionError('missing_reason', 'a correction reason is required');
  }
  const idempotencyKey =
    input.idempotencyKey ?? `correction:${input.matchId}:${input.correctedWinnerPlayerId ?? 'draw'}`;

  const outcome = db.transaction((): CorrectMatchResultOutcome => {
    const match = getMatch(input.matchId);
    if (!match) {
      throw new MatchCorrectionError('match_not_found', `unknown match "${input.matchId}"`);
    }
    const tournament = getTournamentById(match.tournament_id);
    if (!tournament) {
      throw new MatchCorrectionError('tournament_not_found', 'tournament for match not found');
    }
    if (match.status !== 'completed') {
      throw new MatchCorrectionError(
        'match_not_completed',
        'only a completed match result can be corrected'
      );
    }

    const participants = getMatchParticipants(match.id);
    if (participants.length !== 2) {
      throw new MatchCorrectionError(
        'not_two_participants',
        `match must have exactly two participants (got ${participants.length})`
      );
    }
    const correctedWinner = input.correctedWinnerPlayerId ?? null;
    if (correctedWinner !== null && !participants.some((p) => p.player_id === correctedWinner)) {
      throw new MatchCorrectionError(
        'invalid_corrected_winner',
        'corrected winner is not a match participant'
      );
    }

    // Idempotent replay: same key already recorded.
    const existing = db
      .prepare(
        'SELECT match_id, corrected_winner_player_id FROM match_result_corrections WHERE idempotency_key = ?'
      )
      .get(idempotencyKey) as CorrectionAuditRow | undefined;
    if (existing) {
      if (
        existing.match_id === match.id &&
        (existing.corrected_winner_player_id ?? null) === correctedWinner
      ) {
        return buildOutcome(
          match,
          match.winner_player_id,
          correctedWinner,
          true,
          getTournamentChampion(match.tournament_id)
        );
      }
      throw new MatchCorrectionError(
        'duplicate_correction',
        'this correction key was already used for a different correction'
      );
    }

    const previousWinner = match.winner_player_id;
    const changed = previousWinner !== correctedWinner;

    // ---- Bracket reconciliation (before mutating the match row) ----
    if (match.next_match_id) {
      const next = getMatch(match.next_match_id);
      if (!next) {
        throw new MatchCorrectionError('invalid_match', 'downstream match is missing');
      }
      if (next.status === 'completed' || next.status === 'disputed') {
        throw new MatchCorrectionError(
          'downstream_conflict',
          'the downstream match already has a recorded result; resolve it explicitly first'
        );
      }
      if (next.status === 'scheduled' || next.status === 'active') {
        throw new MatchCorrectionError(
          'downstream_in_progress',
          'the downstream match has already started'
        );
      }
      if (next.status === 'pending') {
        const slot = match.next_match_slot;
        if (slot !== 1 && slot !== 2) {
          throw new MatchCorrectionError('invalid_match', 'downstream slot is missing');
        }
        db.prepare(
          'DELETE FROM tournament_match_participants WHERE match_id = ? AND slot = ?'
        ).run(next.id, slot);
        if (correctedWinner !== null) {
          db.prepare(
            `INSERT INTO tournament_match_participants (match_id, player_id, slot, seed, created_at)
             VALUES (?, ?, ?, NULL, ?)`
          ).run(next.id, correctedWinner, slot, now);
        }
      }
      // `cancelled` downstream matches carry no live advancement; leave them.
    }

    // ---- Authoritative match row ----
    db.prepare(
      `UPDATE tournament_matches
          SET winner_player_id = ?, status = 'completed', result_source = 'admin',
              completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE id = ?`
    ).run(correctedWinner, now, now, match.id);

    // ---- Competitive ledger compensation + deterministic rebuild ----
    if (changed) {
      for (const participant of participants) {
        const playerId = participant.player_id;
        const opponentId = participants.find((p) => p.player_id !== playerId)!.player_id;
        const oldResult = resultFor(previousWinner, playerId);
        const newResult = resultFor(correctedWinner, playerId);

        // LP: reverse the match's current net contribution, then apply the new
        // result from that restored balance. The reversal row is ALWAYS written
        // (even at amount 0) because the W/L/D stats are derived from ledger
        // reasons, not from the LP amount.
        const lpNet = currentMatchLpNet(match.id, playerId);
        applyLpDelta({
          playerId,
          gameId: match.game_id,
          delta: -lpNet,
          reason: `match_${oldResult}`,
          sourceType: 'reversal',
          idempotencyKey: `${idempotencyKey}:${playerId}:lp:reversal`,
          matchId: match.id,
          tournamentId: match.tournament_id,
        });
        applyLpResult({
          playerId,
          gameId: match.game_id,
          result: newResult,
          reason: `match_${newResult}`,
          sourceType: 'correction',
          idempotencyKey: `${idempotencyKey}:${playerId}:lp:correction`,
          matchId: match.id,
          tournamentId: match.tournament_id,
        });

        // Elo: reverse the match's current net delta, then apply the corrected
        // delta computed from the historical pre-match ratings.
        const eloNet = currentMatchEloNet(match.id, playerId);
        if (eloNet !== 0) {
          applyEloDelta({
            playerId,
            gameId: match.game_id,
            delta: -eloNet,
            sourceType: 'reversal',
            idempotencyKey: `${idempotencyKey}:${playerId}:elo:reversal`,
            matchId: match.id,
          });
        }
        const ownPre = preMatchRating(match.id, playerId);
        const oppPre = preMatchRating(match.id, opponentId);
        if (ownPre !== null && oppPre !== null) {
          const calc = computeElo(ownPre, oppPre, newResult);
          applyEloDelta({
            playerId,
            gameId: match.game_id,
            delta: calc.delta,
            sourceType: 'correction',
            idempotencyKey: `${idempotencyKey}:${playerId}:elo:correction`,
            matchId: match.id,
          });
        } else {
          // No historical rating (should not happen for a completed match);
          // keep the profile consistent with the ledger we have.
          getOrCreateProfile(playerId, match.game_id);
        }

        // Materialized profile is rebuilt from the immutable ledgers so LP/Elo
        // and W/L/D always equal the deterministic reconstruction.
        rebuildProfile(playerId, match.game_id);
      }
    }

    // ---- Tournament / champion ----
    let championPlayerId: string | null = getTournamentChampion(match.tournament_id);
    if (match.next_match_id === null) {
      championPlayerId = correctedWinner;
      if (correctedWinner !== null) {
        updateTournament(match.tournament_id, { status: 'completed' });
      }
    }

    // ---- Immutable audit row ----
    db.prepare(
      `INSERT INTO match_result_corrections
         (match_id, tournament_id, game_id, previous_winner_player_id, corrected_winner_player_id,
          previous_result, corrected_result, reason, actor_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      match.id,
      match.tournament_id,
      match.game_id,
      previousWinner,
      correctedWinner,
      kindOf(previousWinner),
      kindOf(correctedWinner),
      reason,
      input.actorId ?? null,
      idempotencyKey,
      now
    );

    const finalMatch = getMatch(match.id)!;
    return {
      match: finalMatch,
      previousWinnerPlayerId: previousWinner,
      correctedWinnerPlayerId: correctedWinner,
      changed,
      alreadyProcessed: false,
      tournamentCompleted: match.next_match_id === null && correctedWinner !== null,
      championPlayerId,
      affectedPlayerIds: participants.map((p) => p.player_id),
    };
  })();

  // Events strictly AFTER commit. No success event can be emitted on rollback.
  if (!outcome.alreadyProcessed && outcome.changed) {
    const tournamentId = outcome.match.tournament_id;
    const gameId = outcome.match.game_id;
    emitCompetitiveEvent({ type: 'match.corrected', tournamentId, gameId, matchId: outcome.match.id });
    emitCompetitiveEvent({ type: 'match.updated', tournamentId, gameId, matchId: outcome.match.id });
    emitCompetitiveEvent({ type: 'bracket.updated', tournamentId, gameId });
    emitCompetitiveEvent({ type: 'tournament.updated', tournamentId, gameId });
    if (outcome.tournamentCompleted) {
      emitCompetitiveEvent({
        type: 'tournament.completed',
        tournamentId,
        gameId,
        championPlayerId: outcome.championPlayerId,
      });
    }
    for (const playerId of outcome.affectedPlayerIds) {
      emitCompetitiveEvent({ type: 'competitive_profile.updated', gameId, playerId });
    }
  }

  return outcome;
}
