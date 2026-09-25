/**
 * Phase 4F — MatchCorrectionService.
 *
 * Secure, atomic, idempotent correction of an already-completed tournament
 * match result. This is deliberately separate from `recordMatchResult`
 * (which records a *first* result): correction only ever runs against a
 * `completed` match and reconciles LP, Elo, W/L/D, bracket advancement and the
 * tournament champion.
 *
 * Roadmap #2 — a match side is either an individual player (legacy) or a team.
 * Correction expands each side to its member players and applies the existing
 * per-player compensation/re-application exactly once per member (D1). No team
 * rating system is introduced.
 *
 * Design:
 * - Immutable ledgers: the original LP/Elo rows are never edited. Correction
 *   writes compensating `reversal` rows (negating the match's current net
 *   effect) followed by `correction` rows for the new result. The authoritative
 *   materialized profile is then rebuilt deterministically from the ledger
 *   (`CompetitiveRebuildService`).
 * - Elo is recomputed against the match's *historical* pre-match ratings
 *   (averaged over each team side), keeping it deterministic regardless of
 *   other matches played in between.
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
import { computeElo, computeTeamMatchElo } from './eloEngine';
import { getOrCreateProfile } from './CompetitiveProfileService';
import { rebuildProfile } from './CompetitiveRebuildService';
import { awardMatchXp, reverseMatchXp, rebuildProgression } from './GlobalProgressionService';
import {
  getMatch,
  getMatchParticipants,
  getTournamentChampion,
  getTournamentChampionTeam,
  type TournamentMatchRow,
} from './TournamentMatchService';
import { getTeamMembers } from './TeamService';
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
  /** Individual tournaments: corrected winning player (null = draw). */
  correctedWinnerPlayerId?: string | null;
  /** Team tournaments: corrected winning team (null = draw). */
  correctedWinnerTeamId?: string | null;
  reason: string;
  /** Actor (admin user id) if available; stored in the audit row. */
  actorId?: string | null;
  /** Defaults to `correction:<matchId>:<winnerOrDraw>`. */
  idempotencyKey?: string;
}

export interface CorrectMatchResultOutcome {
  match: TournamentMatchRow;
  previousWinnerPlayerId: string | null;
  previousWinnerTeamId: string | null;
  correctedWinnerPlayerId: string | null;
  correctedWinnerTeamId: string | null;
  changed: boolean;
  alreadyProcessed: boolean;
  tournamentCompleted: boolean;
  championPlayerId: string | null;
  championTeamId: string | null;
  affectedPlayerIds: string[];
}

interface CorrectionAuditRow {
  match_id: string;
  corrected_winner_player_id: string | null;
  corrected_winner_team_id: string | null;
}

/** One competitor side of a match, expanded to its member players. */
interface Side {
  kind: 'player' | 'team';
  id: string;
  members: string[];
}

function sidesFromMatch(matchId: string): Side[] {
  return getMatchParticipants(matchId).map((p) => {
    if (p.team_id !== null) {
      return { kind: 'team' as const, id: p.team_id, members: getTeamMembers(p.team_id) };
    }
    return { kind: 'player' as const, id: p.player_id!, members: [p.player_id!] };
  });
}

function sideKey(side: Side | null): string | null {
  return side ? `${side.kind}:${side.id}` : null;
}

function resultForSide(winner: Side | null, side: Side): CompetitiveResult {
  if (!winner) return 'draw';
  return winner.kind === side.kind && winner.id === side.id ? 'win' : 'loss';
}

function kindOf(winner: Side | null): CorrectionResultKind {
  return winner === null ? 'draw' : 'win';
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

/** Average historical pre-match rating of a side (null when unknown). */
function sidePreRating(matchId: string, side: Side): number | null {
  const ratings = side.members
    .map((id) => preMatchRating(matchId, id))
    .filter((r): r is number => r !== null);
  if (ratings.length === 0) return null;
  return ratings.reduce((sum, r) => sum + r, 0) / ratings.length;
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
  previousWinner: Side | null,
  correctedWinner: Side | null,
  alreadyProcessed: boolean,
  championPlayer: string | null,
  championTeam: string | null
): CorrectMatchResultOutcome {
  return {
    match,
    previousWinnerPlayerId: previousWinner?.kind === 'player' ? previousWinner.id : null,
    previousWinnerTeamId: previousWinner?.kind === 'team' ? previousWinner.id : null,
    correctedWinnerPlayerId: correctedWinner?.kind === 'player' ? correctedWinner.id : null,
    correctedWinnerTeamId: correctedWinner?.kind === 'team' ? correctedWinner.id : null,
    changed: sideKey(previousWinner) !== sideKey(correctedWinner) && !alreadyProcessed,
    alreadyProcessed,
    tournamentCompleted: match.next_match_id === null && correctedWinner !== null,
    championPlayerId: championPlayer,
    championTeamId: championTeam,
    affectedPlayerIds: getMatchParticipants(match.id).flatMap((p) =>
      p.team_id !== null ? getTeamMembers(p.team_id) : p.player_id ? [p.player_id] : []
    ),
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

  const correctedPlayerId = input.correctedWinnerPlayerId ?? null;
  const correctedTeamId = input.correctedWinnerTeamId ?? null;
  if (correctedPlayerId !== null && correctedTeamId !== null) {
    throw new MatchCorrectionError('invalid_corrected_winner', 'specify either a player or a team, not both');
  }
  const correctedRef = correctedPlayerId ?? correctedTeamId ?? 'draw';
  const idempotencyKey = input.idempotencyKey ?? `correction:${input.matchId}:${correctedRef}`;

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

    const sides = sidesFromMatch(match.id);
    if (sides.some((s) => s.members.length === 0)) {
      throw new MatchCorrectionError('invalid_match', 'a match side has no members');
    }

    const previousWinner =
      match.winner_team_id !== null
        ? sides.find((s) => s.kind === 'team' && s.id === match.winner_team_id) ?? null
        : match.winner_player_id !== null
          ? sides.find((s) => s.kind === 'player' && s.id === match.winner_player_id) ?? null
          : null;

    let correctedWinner: Side | null = null;
    if (correctedPlayerId !== null) {
      correctedWinner = sides.find((s) => s.kind === 'player' && s.id === correctedPlayerId) ?? null;
    } else if (correctedTeamId !== null) {
      correctedWinner = sides.find((s) => s.kind === 'team' && s.id === correctedTeamId) ?? null;
    }
    if ((correctedPlayerId !== null || correctedTeamId !== null) && correctedWinner === null) {
      throw new MatchCorrectionError(
        'invalid_corrected_winner',
        'corrected winner is not a match participant'
      );
    }

    // Idempotent replay: same key already recorded.
    const existing = db
      .prepare(
        `SELECT match_id, corrected_winner_player_id, corrected_winner_team_id
           FROM match_result_corrections WHERE idempotency_key = ?`
      )
      .get(idempotencyKey) as CorrectionAuditRow | undefined;
    if (existing) {
      const sameTarget =
        existing.match_id === match.id &&
        (existing.corrected_winner_player_id ?? null) === correctedPlayerId &&
        (existing.corrected_winner_team_id ?? null) === correctedTeamId;
      if (sameTarget) {
        return buildOutcome(
          match,
          previousWinner,
          correctedWinner,
          true,
          getTournamentChampion(match.tournament_id),
          getTournamentChampionTeam(match.tournament_id)
        );
      }
      throw new MatchCorrectionError(
        'duplicate_correction',
        'this correction key was already used for a different correction'
      );
    }

    const changed = sideKey(previousWinner) !== sideKey(correctedWinner);

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
            `INSERT INTO tournament_match_participants (match_id, player_id, team_id, slot, seed, created_at)
             VALUES (?, ?, ?, ?, NULL, ?)`
          ).run(
            next.id,
            correctedWinner.kind === 'player' ? correctedWinner.id : null,
            correctedWinner.kind === 'team' ? correctedWinner.id : null,
            slot,
            now
          );
        }
      }
      // `cancelled` downstream matches carry no live advancement; leave them.
    }

    // ---- Authoritative match row ----
    db.prepare(
      `UPDATE tournament_matches
          SET winner_player_id = ?, winner_team_id = ?, status = 'completed', result_source = 'admin',
              completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE id = ?`
    ).run(
      correctedWinner?.kind === 'player' ? correctedWinner.id : null,
      correctedWinner?.kind === 'team' ? correctedWinner.id : null,
      now,
      now,
      match.id
    );

    // ---- Competitive ledger compensation + deterministic rebuild ----
    if (changed) {
      // Team matches recompute the corrected per-member Elo from the same
      // zero-sum team engine (historical pre-match ratings), while individual
      // matches keep the exact existing 1v1 computation.
      const isTeamMatch = sides.some((s) => s.kind === 'team');
      const correctedEloDeltaByPlayer = new Map<string, number>();
      if (isTeamMatch) {
        const preRating = (playerId: string): number => {
          const historical = preMatchRating(match.id, playerId);
          return historical !== null ? historical : getOrCreateProfile(playerId, match.game_id).elo;
        };
        if (correctedWinner) {
          const loserSide = sides.find((s) => s !== correctedWinner)!;
          const calc = computeTeamMatchElo(
            correctedWinner.members.map(preRating),
            loserSide.members.map(preRating),
            'win'
          );
          correctedWinner.members.forEach((pid, index) =>
            correctedEloDeltaByPlayer.set(pid, calc.playerA.deltas[index])
          );
          loserSide.members.forEach((pid, index) =>
            correctedEloDeltaByPlayer.set(pid, calc.playerB.deltas[index])
          );
        } else {
          // Corrected draw: both sides are scored as a draw (still zero-sum).
          const [sideA, sideB] = sides;
          const calc = computeTeamMatchElo(
            sideA.members.map(preRating),
            sideB.members.map(preRating),
            'draw'
          );
          sideA.members.forEach((pid, index) =>
            correctedEloDeltaByPlayer.set(pid, calc.playerA.deltas[index])
          );
          sideB.members.forEach((pid, index) =>
            correctedEloDeltaByPlayer.set(pid, calc.playerB.deltas[index])
          );
        }
      }

      const opponentOf = (side: Side): Side => sides.find((s) => s !== side)!;
      for (const side of sides) {
        const opponent = opponentOf(side);
        const opponentPreRating = sidePreRating(match.id, opponent);
        const oldResult = resultForSide(previousWinner, side);
        const newResult = resultForSide(correctedWinner, side);

        for (const playerId of side.members) {
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
          if (isTeamMatch) {
            applyEloDelta({
              playerId,
              gameId: match.game_id,
              delta: correctedEloDeltaByPlayer.get(playerId) ?? 0,
              sourceType: 'correction',
              idempotencyKey: `${idempotencyKey}:${playerId}:elo:correction`,
              matchId: match.id,
            });
          } else {
            const ownPre = preMatchRating(match.id, playerId);
            const oppPre = opponentPreRating ?? sidePreRating(match.id, opponent);
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
          }

          // Materialized profile is rebuilt from the immutable ledgers so LP/Elo
          // and W/L/D always equal the deterministic reconstruction.
          rebuildProfile(playerId, match.game_id);

          // Global Competitive XP: append a compensating reversal, then the
          // corrected award. The original row is never edited/deleted.
          reverseMatchXp({
            playerId,
            matchId: match.id,
            idempotencyKey: `${idempotencyKey}:${playerId}:xp:reversal`,
            reversalOf: `match:${match.id}:${playerId}:xp`,
          });
          awardMatchXp({
            playerId,
            matchId: match.id,
            tournamentId: match.tournament_id,
            gameId: match.game_id,
            result: newResult,
            eventType: 'correction',
            idempotencyKey: `${idempotencyKey}:${playerId}:xp:correction`,
          });
          rebuildProgression(playerId);
        }
      }
    }

    // ---- Tournament / champion ----
    let championPlayerId: string | null = getTournamentChampion(match.tournament_id);
    let championTeamId: string | null = getTournamentChampionTeam(match.tournament_id);
    if (match.next_match_id === null) {
      championPlayerId = correctedWinner?.kind === 'player' ? correctedWinner.id : null;
      championTeamId = correctedWinner?.kind === 'team' ? correctedWinner.id : null;
      if (correctedWinner !== null) {
        updateTournament(match.tournament_id, { status: 'completed' });
      }
    }

    // ---- Immutable audit row ----
    db.prepare(
      `INSERT INTO match_result_corrections
         (match_id, tournament_id, game_id,
          previous_winner_player_id, previous_winner_team_id,
          corrected_winner_player_id, corrected_winner_team_id,
          previous_result, corrected_result, reason, actor_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      match.id,
      match.tournament_id,
      match.game_id,
      previousWinner?.kind === 'player' ? previousWinner.id : null,
      previousWinner?.kind === 'team' ? previousWinner.id : null,
      correctedWinner?.kind === 'player' ? correctedWinner.id : null,
      correctedWinner?.kind === 'team' ? correctedWinner.id : null,
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
      previousWinnerPlayerId: previousWinner?.kind === 'player' ? previousWinner.id : null,
      previousWinnerTeamId: previousWinner?.kind === 'team' ? previousWinner.id : null,
      correctedWinnerPlayerId: correctedWinner?.kind === 'player' ? correctedWinner.id : null,
      correctedWinnerTeamId: correctedWinner?.kind === 'team' ? correctedWinner.id : null,
      changed,
      alreadyProcessed: false,
      tournamentCompleted: match.next_match_id === null && correctedWinner !== null,
      championPlayerId,
      championTeamId,
      affectedPlayerIds: sides.flatMap((s) => s.members),
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
    for (const playerId of new Set(outcome.affectedPlayerIds)) {
      emitCompetitiveEvent({ type: 'competitive_profile.updated', gameId, playerId });
    }
  }

  return outcome;
}
