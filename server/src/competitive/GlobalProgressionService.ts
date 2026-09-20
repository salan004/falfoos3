/**
 * Phase 2.z — Global Competitive Progression service.
 *
 * Owns the GLOBAL competitive XP ledger (`competitive_xp_transactions`) and its
 * materialized total (`competitive_progressions`), mirroring the LP/Elo
 * architecture. XP is global across all competitive games and is completely
 * independent of LP, Elo, rank and Stream Games.
 *
 * - `applyXpDelta` is the low-level ledger primitive (idempotent via the UNIQUE
 *   `idempotency_key`; ledger + materialized total commit atomically).
 * - `awardMatchXp` / `awardCorrectionXp` / `reverseMatchXp` are the domain
 *   entry points used by `recordMatchResult` / `correctMatchResult`.
 * - `rebuildProgression` deterministically reconstructs the total from the
 *   ledger; it never reads LP/Elo/rank or Stream Game data.
 */

import { getDb } from '../db/db';
import { playerExists } from './CompetitiveProfileService';
import { computeXpForResult } from './competitiveXpEngine';
import {
  computeCompetitiveLevel,
  type CompetitiveLevelInfo,
  type CompetitiveTier,
} from './competitiveLevel';
import type { CompetitiveResult } from './types';

export type XpEventType = 'match' | 'correction' | 'reversal' | 'admin' | 'system';

export interface ProgressionRow {
  player_id: string;
  total_xp: number;
  created_at: number;
  updated_at: number;
}

export interface XpApplyResult {
  /** True only when this call inserted the ledger row and moved XP. */
  applied: boolean;
  /** True when the idempotency key already existed (no double application). */
  alreadyProcessed: boolean;
  transactionId: number | null;
  /** Materialized total after the call. */
  totalXp: number;
  /** Effective XP change of this call. */
  amount: number;
}

export interface ApplyXpDeltaInput {
  playerId: string;
  amount: number;
  eventType: XpEventType;
  idempotencyKey: string;
  matchId?: string | null;
  tournamentId?: string | null;
  gameId?: string | null;
  sourceEventId?: string | null;
  reversalOf?: string | null;
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`globalProgression: ${name} must be a non-empty string`);
  }
}

export function getProgression(playerId: string): ProgressionRow | null {
  const row = getDb()
    .prepare('SELECT * FROM competitive_progressions WHERE player_id = ?')
    .get(playerId) as ProgressionRow | undefined;
  return row ?? null;
}

/** Returns the materialized total row, creating it at 0 XP on first use. */
export function getOrCreateProgression(playerId: string): ProgressionRow {
  assertNonEmpty(playerId, 'playerId');
  if (!playerExists(playerId)) {
    throw new Error(`globalProgression: unknown player "${playerId}"`);
  }
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO competitive_progressions (player_id, total_xp, created_at, updated_at)
     VALUES (?, 0, ?, ?)`
  ).run(playerId, now, now);
  const row = getProgression(playerId);
  if (!row) throw new Error(`globalProgression: failed to create progression for ${playerId}`);
  return row;
}

interface XpTransactionRow {
  id: number;
  amount: number;
}

/**
 * Low-level ledger primitive: insert one immutable XP row and update the
 * materialized total in ONE transaction. A duplicate `idempotencyKey` is a
 * no-op returning the existing row's amount.
 */
export function applyXpDelta(input: ApplyXpDeltaInput): XpApplyResult {
  assertNonEmpty(input.playerId, 'playerId');
  assertNonEmpty(input.idempotencyKey, 'idempotencyKey');
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
    throw new Error('globalProgression: amount must be a finite number');
  }
  const amount = Math.trunc(input.amount);

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): XpApplyResult => {
    getOrCreateProgression(input.playerId);
    const before = getProgression(input.playerId)!.total_xp;
    const after = Math.max(0, before + amount);
    const effective = after - before;

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO competitive_xp_transactions
           (player_id, match_id, tournament_id, game_id, event_type, amount,
            source_event_id, idempotency_key, reversal_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.playerId,
        input.matchId ?? null,
        input.tournamentId ?? null,
        input.gameId ?? null,
        input.eventType,
        effective,
        input.sourceEventId ?? null,
        input.idempotencyKey,
        input.reversalOf ?? null,
        now
      );

    if (inserted.changes === 0) {
      const existing = db
        .prepare('SELECT id, amount FROM competitive_xp_transactions WHERE idempotency_key = ?')
        .get(input.idempotencyKey) as XpTransactionRow | undefined;
      return {
        applied: false,
        alreadyProcessed: true,
        transactionId: null,
        totalXp: getProgression(input.playerId)!.total_xp,
        amount: existing?.amount ?? 0,
      };
    }

    db.prepare('UPDATE competitive_progressions SET total_xp = ?, updated_at = ? WHERE player_id = ?').run(
      after,
      now,
      input.playerId
    );

    return {
      applied: true,
      alreadyProcessed: false,
      transactionId: Number(inserted.lastInsertRowid),
      totalXp: after,
      amount: effective,
    };
  });

  return tx();
}

/** XP currently attributed to one match + player (net of reversals/corrections). */
export function currentMatchXpNet(matchId: string, playerId: string): number {
  const row = getDb()
    .prepare(
      'SELECT COALESCE(SUM(amount), 0) AS net FROM competitive_xp_transactions WHERE match_id = ? AND player_id = ?'
    )
    .get(matchId, playerId) as { net: number };
  return row.net;
}

export interface MatchXpInput {
  playerId: string;
  matchId: string;
  tournamentId: string;
  gameId: string;
  result: CompetitiveResult;
  idempotencyKey: string;
  eventType?: 'match' | 'correction';
  sourceEventId?: string | null;
}

/** Awards the approved XP for a completed competitive match result. */
export function awardMatchXp(input: MatchXpInput): XpApplyResult {
  return applyXpDelta({
    playerId: input.playerId,
    amount: computeXpForResult(input.result),
    eventType: input.eventType ?? 'match',
    idempotencyKey: input.idempotencyKey,
    matchId: input.matchId,
    tournamentId: input.tournamentId,
    gameId: input.gameId,
    sourceEventId: input.sourceEventId ?? input.matchId,
  });
}

/** Appends a compensating reversal for a match's current net XP (never edits). */
export function reverseMatchXp(input: {
  playerId: string;
  matchId: string;
  idempotencyKey: string;
  reversalOf?: string | null;
}): XpApplyResult {
  return applyXpDelta({
    playerId: input.playerId,
    amount: -currentMatchXpNet(input.matchId, input.playerId),
    eventType: 'reversal',
    idempotencyKey: input.idempotencyKey,
    matchId: input.matchId,
    reversalOf: input.reversalOf ?? null,
  });
}

export function getTotalXp(playerId: string): number {
  return getProgression(playerId)?.total_xp ?? 0;
}

export interface GlobalCompetitiveStats {
  matches: number;
  wins: number;
}

/**
 * Global competitive matches/wins for a player, computed ONLY from completed
 * tournament matches (never Stream Game `participations`/`match_winners`).
 * The participant PK guarantees a match cannot be counted twice; corrections
 * update `winner_player_id`, so wins follow automatically.
 */
export function getGlobalCompetitiveStats(playerId: string): GlobalCompetitiveStats {
  const db = getDb();
  const matches = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT tmp.match_id) AS n
           FROM tournament_match_participants tmp
           JOIN tournament_matches tm ON tm.id = tmp.match_id
          WHERE tmp.player_id = ? AND tm.status = 'completed'`
      )
      .get(playerId) as { n: number }
  ).n;
  const wins = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM tournament_matches
          WHERE status = 'completed' AND winner_player_id = ?`
      )
      .get(playerId) as { n: number }
  ).n;
  return { matches, wins };
}

export interface CompetitiveProgressionDto {
  playerId: string;
  xp: number;
  level: number;
  tier: CompetitiveTier;
  tierLabelAr: string;
  isMax: boolean;
  progress: {
    /** XP where the current level starts. */
    current: number;
    /** XP where the next level starts; null at Level 20. */
    next: number | null;
    /** 0–100 progress inside the current level. */
    pct: number;
    /** XP earned inside the current level. */
    intoLevel: number;
    /** XP remaining to the next level; null at Level 20. */
    forNext: number | null;
  };
  matches: number;
  wins: number;
}

export function getCompetitiveProgressionDto(playerId: string): CompetitiveProgressionDto {
  const xp = getTotalXp(playerId);
  const level: CompetitiveLevelInfo = computeCompetitiveLevel(xp);
  const stats = getGlobalCompetitiveStats(playerId);
  return {
    playerId,
    xp,
    level: level.level,
    tier: level.tier,
    tierLabelAr: level.tierLabelAr,
    isMax: level.isMax,
    progress: {
      current: level.currentLevelXp,
      next: level.nextLevelXp,
      pct: level.progressPct,
      intoLevel: level.xpIntoLevel,
      forNext: level.xpForNext,
    },
    matches: stats.matches,
    wins: stats.wins,
  };
}

/** Net XP derived from the immutable ledger (deterministic; clamped at 0). */
export function deriveTotalXp(playerId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(amount), 0) AS net FROM competitive_xp_transactions WHERE player_id = ?')
    .get(playerId) as { net: number };
  return Math.max(0, row.net);
}

export interface RebuildResult {
  playerId: string;
  before: number;
  after: number;
  changed: boolean;
}

/** Rebuilds one materialized total from the ledger. Never reads LP/Elo/rank. */
export function rebuildProgression(playerId: string): RebuildResult {
  const db = getDb();
  const now = Date.now();
  const tx = db.transaction((): RebuildResult => {
    getOrCreateProgression(playerId);
    const before = getProgression(playerId)!.total_xp;
    const after = deriveTotalXp(playerId);
    db.prepare('UPDATE competitive_progressions SET total_xp = ?, updated_at = ? WHERE player_id = ?').run(
      after,
      now,
      playerId
    );
    return { playerId, before, after, changed: before !== after };
  });
  return tx();
}

/** Rebuilds every player referenced by the progression table or the ledger. */
export function rebuildAllProgressions(): RebuildResult[] {
  const rows = getDb()
    .prepare(
      `SELECT player_id AS player_id FROM competitive_progressions
        UNION
       SELECT player_id AS player_id FROM competitive_xp_transactions`
    )
    .all() as { player_id: string }[];
  return rows.map((r) => rebuildProgression(r.player_id));
}

export interface BackfillResult {
  matchesScanned: number;
  awardsInserted: number;
  awardsSkipped: number;
  playerRows: number;
}

/**
 * Idempotent historical backfill: awards XP for every COMPLETED tournament
 * match with a valid result, using the approved rules. Cancelled/incomplete
 * matches and byes (no match row) are never touched. Canonical player ids only.
 * Safe to run repeatedly (match/player-scoped idempotency keys).
 *
 * NOT executed automatically; production runs are a separate controlled step
 * (after Phase 2.x identity reconciliation).
 */
export function backfillCompetitiveXp(): BackfillResult {
  const db = getDb();
  const matches = db
    .prepare(
      `SELECT id, tournament_id, game_id, winner_player_id
         FROM tournament_matches
        WHERE status = 'completed'`
    )
    .all() as {
    id: string;
    tournament_id: string;
    game_id: string;
    winner_player_id: string | null;
  }[];

  let awardsInserted = 0;
  let awardsSkipped = 0;

  for (const match of matches) {
    const participants = db
      .prepare('SELECT player_id FROM tournament_match_participants WHERE match_id = ?')
      .all(match.id) as { player_id: string }[];
    if (participants.length !== 2) continue; // byes / malformed → no XP

    for (const participant of participants) {
      const result: CompetitiveResult =
        match.winner_player_id === null
          ? 'draw'
          : match.winner_player_id === participant.player_id
            ? 'win'
            : 'loss';
      const outcome = awardMatchXp({
        playerId: participant.player_id,
        matchId: match.id,
        tournamentId: match.tournament_id,
        gameId: match.game_id,
        result,
        idempotencyKey: `match:${match.id}:${participant.player_id}:xp`,
        sourceEventId: match.id,
      });
      if (outcome.applied) awardsInserted += 1;
      else awardsSkipped += 1;
    }
  }

  // Materialize any player that has ledger rows but no progression row yet.
  const playerRows = rebuildAllProgressions().length;

  return { matchesScanned: matches.length, awardsInserted, awardsSkipped, playerRows };
}
