/**
 * Phase 4C — BracketService.
 *
 * Generates a single-elimination bracket for an `open` tournament from its
 * already-registered `tournament_participants`, then transitions the tournament
 * to `active`. The entire generation runs in ONE transaction: a failure leaves
 * no partial bracket and the tournament unchanged.
 *
 * Randomization:
 * - participants are shuffled once, at generation, using Node's crypto RNG by
 *   default (`crypto.randomInt`) via an unbiased Fisher–Yates shuffle.
 * - tests may inject a deterministic `randomInt` via `options.randomInt`.
 * - the bracket is locked after generation: a second call is rejected; nothing
 *   ever reshuffles on reload, result, or advancement.
 *
 * Byes:
 * - bracket size is the smallest power of two >= participant count.
 * - byes = bracketSize - participantCount. The standard seed order
 *   (1 vs B, 2 vs B-1, ...) guarantees at most one bye per first-round pair and
 *   spreads them across the bracket.
 * - a bye is NOT a match: the player is placed directly into their next-round
 *   slot, and no match row (playable or fake) is created for it. Byes therefore
 *   never award LP/Elo/stats.
 */

import { randomInt, randomUUID } from 'crypto';
import { getDb } from '../db/db';
import { updateTournament, type TournamentRow } from '../games/TournamentService';
import { emitCompetitiveEvent } from './competitiveEvents';

export class BracketError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BracketError';
  }
}

export interface GenerateBracketOptions {
  /** Test-only deterministic RNG: returns an integer in [0, maxExclusive). */
  randomInt?: (maxExclusive: number) => number;
}

export interface GenerateBracketResult {
  tournamentId: string;
  gameId: string;
  bracketSize: number;
  totalRounds: number;
  byes: number;
  participantCount: number;
  matchCount: number;
}

export interface BracketParticipantView {
  playerId: string;
  slot: number;
  seed: number | null;
}

export interface BracketMatchView {
  id: string;
  roundNo: number;
  slotNo: number;
  status: string;
  bestOf: number | null;
  winnerPlayerId: string | null;
  nextMatchId: string | null;
  nextMatchSlot: number | null;
  scheduledAt: number | null;
  startedAt: number | null;
  completedAt: number | null;
  participants: BracketParticipantView[];
}

export interface BracketRoundView {
  roundNo: number;
  nameEn: string;
  nameAr: string;
  matches: BracketMatchView[];
}

export interface TournamentBracketView {
  tournamentId: string;
  gameId: string;
  tournamentStatus: string;
  bracketSize: number;
  totalRounds: number;
  byes: number;
  participantCount: number;
  rounds: BracketRoundView[];
}

interface TournamentMatchRow {
  id: string;
  tournament_id: string;
  game_id: string;
  round_no: number;
  slot_no: number;
  status: string;
  best_of: number | null;
  winner_player_id: string | null;
  next_match_id: string | null;
  next_match_slot: number | null;
  scheduled_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}

/** Smallest power of two >= n (n >= 1). */
export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard single-elimination seed order for a bracket of `size` leaves.
 * The list is indexed by bracket leaf position; the value is the seed number.
 * E.g. size 8 → [1,8,4,5,2,7,3,6] (1 plays 8, 4 plays 5, ...).
 */
export function buildSeedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const doubled = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed);
      next.push(doubled + 1 - seed);
    }
    order = next;
  }
  return order;
}

/** Round display name derived from the number of players alive in that round. */
export function roundNameForPlayers(playersAlive: number): { en: string; ar: string } {
  if (playersAlive <= 2) return { en: 'Final', ar: 'النهائي' };
  if (playersAlive === 4) return { en: 'Semi Final', ar: 'نصف النهائي' };
  if (playersAlive === 8) return { en: 'Quarter Final', ar: 'ربع النهائي' };
  return { en: `Round of ${playersAlive}`, ar: `دور الـ${playersAlive}` };
}

/** Unbiased Fisher–Yates shuffle using the supplied integer RNG. */
function shuffle<T>(items: T[], randomIntExclusive: (maxExclusive: number) => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomIntExclusive(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) {
      throw new BracketError('bad_rng', `RNG returned an out-of-range value: ${j}`);
    }
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** True when a bracket already exists for the tournament. */
export function hasBracket(tournamentId: string): boolean {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tournament_matches WHERE tournament_id = ?')
    .get(tournamentId) as { n: number };
  return row.n > 0;
}

/**
 * Generates the bracket. Throws `BracketError` with a machine-readable code on
 * any invalid precondition; guaranteed atomic.
 */
export function generateBracket(
  tournamentId: string,
  options?: GenerateBracketOptions
): GenerateBracketResult {
  const db = getDb();
  const now = Date.now();
  const randomIntExclusive = options?.randomInt ?? ((max: number) => randomInt(max));

  const tx = db.transaction((): GenerateBracketResult => {
    const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as
      | TournamentRow
      | undefined;
    if (!tournament) {
      throw new BracketError('tournament_not_found', `unknown tournament "${tournamentId}"`);
    }
    if (hasBracket(tournamentId)) {
      throw new BracketError('already_generated', 'bracket already generated for this tournament');
    }
    if (tournament.status !== 'open') {
      throw new BracketError(
        'invalid_tournament_state',
        `tournament must be open to generate a bracket (got "${tournament.status}")`
      );
    }

    const participantRows = db
      .prepare(
        `SELECT player_id FROM tournament_participants
          WHERE tournament_id = ? AND status IN ('registered','confirmed')
          ORDER BY player_id ASC`
      )
      .all(tournamentId) as { player_id: string }[];

    // The participant rows are authoritative; the denormalized participant_count
    // is never trusted for bracket sizing.
    const players = [...new Set(participantRows.map((r) => r.player_id))];
    if (players.length < 2) {
      throw new BracketError(
        'not_enough_participants',
        `at least 2 eligible participants are required (got ${players.length})`
      );
    }

    const participantCount = players.length;
    const bracketSize = nextPowerOfTwo(participantCount);
    const totalRounds = Math.log2(bracketSize);
    const byes = bracketSize - participantCount;

    // Randomized seeding: shuffled players are assigned seeds 1..N; higher seeds
    // (N+1..B) are byes.
    const shuffled = shuffle(players, randomIntExclusive);
    const seedToPlayer = new Map<number, string>();
    shuffled.forEach((playerId, index) => seedToPlayer.set(index + 1, playerId));

    const seedOrder = buildSeedOrder(bracketSize);
    const leaves = seedOrder.map((seed) => ({
      seed,
      playerId: seed <= participantCount ? seedToPlayer.get(seed)! : null,
    }));

    const roundCounts: number[] = [];
    for (let round = 1; round <= totalRounds; round++) {
      roundCounts.push(bracketSize / Math.pow(2, round));
    }

    // positionKey(round, position) -> match id
    const matchIdByPosition = new Map<string, string>();
    let matchCount = 0;

    const insertMatch = (roundNo: number, position: number, slotNo: number): string => {
      const id = randomUUID();
      db.prepare(
        `INSERT INTO tournament_matches
           (id, tournament_id, game_id, round_no, slot_no, status, best_of,
            winner_player_id, next_match_id, next_match_slot,
            scheduled_at, started_at, completed_at, result_source, result_idempotency_key,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
      ).run(id, tournamentId, tournament.game_id, roundNo, slotNo, now, now);
      matchIdByPosition.set(`${roundNo}:${position}`, id);
      matchCount += 1;
      return id;
    };

    const insertParticipant = (
      matchId: string,
      playerId: string,
      slot: number,
      seed: number | null
    ): void => {
      db.prepare(
        `INSERT INTO tournament_match_participants (match_id, player_id, slot, seed, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(matchId, playerId, slot, seed, now);
    };

    // Create every match in rounds 2..R (they are always needed as advancement
    // targets), numbering slots densely per round.
    for (let round = 2; round <= totalRounds; round++) {
      const count = roundCounts[round - 1];
      for (let position = 1; position <= count; position++) {
        insertMatch(round, position, position);
      }
    }

    // Round 1: pair adjacent leaves. Create a match only for pairs with two
    // players; a pair with a bye has exactly one player and advances directly.
    const round1Count = roundCounts[0];
    let round1Slot = 0;
    for (let position = 1; position <= round1Count; position++) {
      const left = leaves[(position - 1) * 2];
      const right = leaves[(position - 1) * 2 + 1];
      const present = [left, right].filter((leaf) => leaf.playerId !== null) as {
        seed: number;
        playerId: string;
      }[];

      if (present.length === 2) {
        round1Slot += 1;
        const matchId = insertMatch(1, position, round1Slot);
        insertParticipant(matchId, present[0].playerId, 1, present[0].seed);
        insertParticipant(matchId, present[1].playerId, 2, present[1].seed);
      } else if (present.length === 1) {
        // Bye — no match row. Place the player directly into their next-round slot.
        const player = present[0];
        const nextPosition = Math.ceil(position / 2);
        const nextSlot = position % 2 === 1 ? 1 : 2;
        const nextMatchId = matchIdByPosition.get(`2:${nextPosition}`);
        if (!nextMatchId) {
          throw new BracketError('bad_bracket', 'internal error: missing next-round match for bye');
        }
        insertParticipant(nextMatchId, player.playerId, nextSlot, player.seed);
      } else {
        throw new BracketError('bad_bracket', 'internal error: first-round pair with no players');
      }
    }

    // Connect the graph: winner of (round r, position p) → (round r+1, ceil(p/2))
    // into slot 1 when p is odd, slot 2 when p is even.
    for (let round = 1; round < totalRounds; round++) {
      const count = roundCounts[round - 1];
      for (let position = 1; position <= count; position++) {
        const matchId = matchIdByPosition.get(`${round}:${position}`);
        if (!matchId) continue; // bye position — no match
        const nextPosition = Math.ceil(position / 2);
        const nextSlot = position % 2 === 1 ? 1 : 2;
        const nextMatchId = matchIdByPosition.get(`${round + 1}:${nextPosition}`);
        if (!nextMatchId) {
          throw new BracketError('bad_bracket', 'internal error: missing next match');
        }
        db.prepare(
          'UPDATE tournament_matches SET next_match_id = ?, next_match_slot = ? WHERE id = ?'
        ).run(nextMatchId, nextSlot, matchId);
      }
    }

    // Bracket is complete and valid: transition the tournament open → active.
    // `updateTournament` validates the state machine transition.
    updateTournament(tournamentId, { status: 'active' });

    return {
      tournamentId,
      gameId: tournament.game_id,
      bracketSize,
      totalRounds,
      byes,
      participantCount,
      matchCount,
    };
  });

  const generation = tx();

  // Post-commit invalidation signal only.
  emitCompetitiveEvent({
    type: 'bracket.updated',
    tournamentId: generation.tournamentId,
    gameId: generation.gameId,
  });
  emitCompetitiveEvent({
    type: 'tournament.updated',
    tournamentId: generation.tournamentId,
    gameId: generation.gameId,
  });

  return generation;
}

function readParticipants(matchId: string): BracketParticipantView[] {
  const rows = getDb()
    .prepare(
      `SELECT player_id, slot, seed FROM tournament_match_participants
        WHERE match_id = ? ORDER BY slot ASC`
    )
    .all(matchId) as { player_id: string; slot: number; seed: number | null }[];
  return rows.map((row) => ({ playerId: row.player_id, slot: row.slot, seed: row.seed }));
}

/** Structured bracket read for the future public API/visual bracket. */
export function getTournamentBracket(tournamentId: string): TournamentBracketView | null {
  const db = getDb();
  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as
    | TournamentRow
    | undefined;
  if (!tournament) return null;

  const matchRows = db
    .prepare(
      `SELECT id, tournament_id, game_id, round_no, slot_no, status, best_of,
              winner_player_id, next_match_id, next_match_slot,
              scheduled_at, started_at, completed_at
         FROM tournament_matches
        WHERE tournament_id = ?
        ORDER BY round_no ASC, slot_no ASC`
    )
    .all(tournamentId) as TournamentMatchRow[];

  const participantCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM tournament_participants
          WHERE tournament_id = ? AND status IN ('registered','confirmed')`
      )
      .get(tournamentId) as { n: number }
  ).n;

  if (matchRows.length === 0) {
    return {
      tournamentId,
      gameId: tournament.game_id,
      tournamentStatus: tournament.status,
      bracketSize: 0,
      totalRounds: 0,
      byes: 0,
      participantCount,
      rounds: [],
    };
  }

  const totalRounds = matchRows.reduce((max, m) => Math.max(max, m.round_no), 0);
  const bracketSize = Math.pow(2, totalRounds);
  const byes = Math.max(0, bracketSize - participantCount);

  const rounds: BracketRoundView[] = [];
  for (let round = 1; round <= totalRounds; round++) {
    const playersAlive = bracketSize / Math.pow(2, round - 1);
    const name = roundNameForPlayers(playersAlive);
    const matches = matchRows
      .filter((m) => m.round_no === round)
      .map((m) => ({
        id: m.id,
        roundNo: m.round_no,
        slotNo: m.slot_no,
        status: m.status,
        bestOf: m.best_of,
        winnerPlayerId: m.winner_player_id,
        nextMatchId: m.next_match_id,
        nextMatchSlot: m.next_match_slot,
        scheduledAt: m.scheduled_at,
        startedAt: m.started_at,
        completedAt: m.completed_at,
        participants: readParticipants(m.id),
      }));
    rounds.push({ roundNo: round, nameEn: name.en, nameAr: name.ar, matches });
  }

  return {
    tournamentId,
    gameId: tournament.game_id,
    tournamentStatus: tournament.status,
    bracketSize,
    totalRounds,
    byes,
    participantCount,
    rounds,
  };
}
