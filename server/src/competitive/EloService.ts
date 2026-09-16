/**
 * Phase 4B — EloService.
 *
 * Persists Elo changes through the Phase 4A pure engine (`computeElo`) into the
 * immutable `elo_transactions` ledger and the materialized
 * `competitive_profiles.elo` row. Elo is fully independent from LP.
 *
 * Ledger insert + profile update are atomic (single better-sqlite3
 * transaction). Idempotency is enforced by the `elo_transactions.idempotency_key`
 * UNIQUE constraint. Profile initialization with the default Elo writes NO
 * ledger row — only real rating changes do.
 *
 * No match orchestration, no HTTP, no sockets, no UI.
 */

import { getDb } from '../db/db';
import { computeElo, DEFAULT_K_FACTOR } from './eloEngine';
import { isCompetitiveResult } from './lpEngine';
import { getOrCreateProfile, getProfile, type CompetitiveProfileRow } from './CompetitiveProfileService';
import type { CompetitiveResult, CompetitiveSourceType } from './types';

const SOURCE_TYPES: readonly CompetitiveSourceType[] = [
  'match',
  'tournament',
  'admin',
  'correction',
  'reversal',
  'system',
];

export interface EloApplyResult {
  applied: boolean;
  alreadyProcessed: boolean;
  transactionId: number | null;
  profile: CompetitiveProfileRow;
  delta: number;
  ratingBefore: number;
  ratingAfter: number;
}

export interface ApplyEloResultInput {
  playerId: string;
  gameId: string;
  /** Opponent rating for this match (1v1). */
  opponentRating: number;
  result: CompetitiveResult;
  /** Defaults to the Phase 4A default (32). */
  kFactor?: number;
  sourceType?: CompetitiveSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  matchId?: string | null;
}

export interface ApplyAdminEloAdjustmentInput {
  playerId: string;
  gameId: string;
  /** Signed Elo adjustment. Positive or negative; history is never edited. */
  amount: number;
  idempotencyKey: string;
  /** Provenance reference (e.g. admin user id). Stored in `source_id`. */
  sourceId?: string | null;
}

export interface ApplyEloDeltaInput {
  playerId: string;
  gameId: string;
  /** Signed Elo delta. Used for Phase 4F compensating (`reversal`) entries. */
  delta: number;
  sourceType: CompetitiveSourceType;
  idempotencyKey: string;
  sourceId?: string | null;
  matchId?: string | null;
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`eloService: ${name} must be a non-empty string`);
  }
}

function assertSourceType(value: unknown): asserts value is CompetitiveSourceType {
  if (typeof value !== 'string' || !SOURCE_TYPES.includes(value as CompetitiveSourceType)) {
    throw new Error(`eloService: unsupported sourceType "${String(value)}"`);
  }
}

interface EloTransactionRow {
  id: number;
  delta: number;
  rating_before: number;
  rating_after: number;
}

function findTransaction(idempotencyKey: string): EloTransactionRow | null {
  const row = getDb()
    .prepare(
      'SELECT id, delta, rating_before, rating_after FROM elo_transactions WHERE idempotency_key = ?'
    )
    .get(idempotencyKey) as EloTransactionRow | undefined;
  return row ?? null;
}

/** Applies the official Elo result of a completed competitive 1v1 match. */
export function applyEloResult(input: ApplyEloResultInput): EloApplyResult {
  assertNonEmptyString(input.playerId, 'playerId');
  assertNonEmptyString(input.gameId, 'gameId');
  assertNonEmptyString(input.idempotencyKey, 'idempotencyKey');
  if (typeof input.opponentRating !== 'number' || !Number.isFinite(input.opponentRating)) {
    throw new Error('eloService: opponentRating must be a finite number');
  }
  if (!isCompetitiveResult(input.result)) {
    throw new Error(`eloService: unsupported result "${String(input.result)}"`);
  }
  const sourceType = input.sourceType ?? 'match';
  assertSourceType(sourceType);

  const db = getDb();
  const now = Date.now();
  const kFactor = input.kFactor ?? DEFAULT_K_FACTOR;

  const tx = db.transaction((): EloApplyResult => {
    const profile = getOrCreateProfile(input.playerId, input.gameId);
    const calculation = computeElo(profile.elo, input.opponentRating, input.result, { kFactor });

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO elo_transactions
           (player_id, game_id, delta, rating_before, rating_after, opponent_rating_avg,
            expected_score, k_factor, source_type, source_id, match_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.playerId,
        input.gameId,
        calculation.delta,
        profile.elo,
        calculation.newRating,
        input.opponentRating,
        calculation.expectedScore,
        calculation.kFactor,
        sourceType,
        input.sourceId ?? input.matchId ?? null,
        input.matchId ?? null,
        input.idempotencyKey,
        now
      );

    if (inserted.changes === 0) {
      const existing = findTransaction(input.idempotencyKey);
      return {
        applied: false,
        alreadyProcessed: true,
        transactionId: null,
        profile: getProfile(input.playerId, input.gameId) ?? profile,
        delta: existing?.delta ?? 0,
        ratingBefore: existing?.rating_before ?? profile.elo,
        ratingAfter: existing?.rating_after ?? profile.elo,
      };
    }

    db.prepare(
      'UPDATE competitive_profiles SET elo = ?, updated_at = ? WHERE player_id = ? AND game_id = ?'
    ).run(calculation.newRating, now, input.playerId, input.gameId);

    const updated = getProfile(input.playerId, input.gameId);
    if (!updated) throw new Error('eloService: profile disappeared during update');

    return {
      applied: true,
      alreadyProcessed: false,
      transactionId: Number(inserted.lastInsertRowid),
      profile: updated,
      delta: calculation.delta,
      ratingBefore: profile.elo,
      ratingAfter: calculation.newRating,
    };
  });

  return tx();
}

/**
 * Applies an explicit, caller-supplied Elo delta with an arbitrary source type.
 * Used by Phase 4F to record immutable `reversal` / `correction` entries; the
 * caller computes the delta (the engine rules stay in `eloEngine`). History is
 * never mutated.
 */
export function applyEloDelta(input: ApplyEloDeltaInput): EloApplyResult {
  assertNonEmptyString(input.playerId, 'playerId');
  assertNonEmptyString(input.gameId, 'gameId');
  assertNonEmptyString(input.idempotencyKey, 'idempotencyKey');
  assertSourceType(input.sourceType);
  if (typeof input.delta !== 'number' || !Number.isFinite(input.delta)) {
    throw new Error('eloService: delta must be a finite number');
  }
  const delta = Math.trunc(input.delta);

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): EloApplyResult => {
    const profile = getOrCreateProfile(input.playerId, input.gameId);
    const before = profile.elo;
    const after = before + delta;
    const effective = after - before;

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO elo_transactions
           (player_id, game_id, delta, rating_before, rating_after, opponent_rating_avg,
            expected_score, k_factor, source_type, source_id, match_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
      )
      .run(
        input.playerId,
        input.gameId,
        effective,
        before,
        after,
        input.sourceType,
        input.sourceId ?? input.matchId ?? null,
        input.matchId ?? null,
        input.idempotencyKey,
        now
      );

    if (inserted.changes === 0) {
      const existing = findTransaction(input.idempotencyKey);
      return {
        applied: false,
        alreadyProcessed: true,
        transactionId: null,
        profile: getProfile(input.playerId, input.gameId) ?? profile,
        delta: existing?.delta ?? 0,
        ratingBefore: existing?.rating_before ?? before,
        ratingAfter: existing?.rating_after ?? before,
      };
    }

    db.prepare(
      'UPDATE competitive_profiles SET elo = ?, updated_at = ? WHERE player_id = ? AND game_id = ?'
    ).run(after, now, input.playerId, input.gameId);

    const updated = getProfile(input.playerId, input.gameId);
    if (!updated) throw new Error('eloService: profile disappeared during update');

    return {
      applied: true,
      alreadyProcessed: false,
      transactionId: Number(inserted.lastInsertRowid),
      profile: updated,
      delta: effective,
      ratingBefore: before,
      ratingAfter: after,
    };
  });

  return tx();
}

/**
 * Administrative Elo adjustment. Records an immutable `admin` ledger row and
 * updates the materialized rating. `k_factor`, `opponent_rating_avg` and
 * `expected_score` stay NULL because no match produced this change.
 */
export function applyAdminEloAdjustment(input: ApplyAdminEloAdjustmentInput): EloApplyResult {
  assertNonEmptyString(input.playerId, 'playerId');
  assertNonEmptyString(input.gameId, 'gameId');
  assertNonEmptyString(input.idempotencyKey, 'idempotencyKey');
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
    throw new Error('eloService: amount must be a finite number');
  }
  const amount = Math.trunc(input.amount);

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): EloApplyResult => {
    const profile = getOrCreateProfile(input.playerId, input.gameId);
    const before = profile.elo;
    const after = before + amount;
    const delta = after - before;

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO elo_transactions
           (player_id, game_id, delta, rating_before, rating_after, opponent_rating_avg,
            expected_score, k_factor, source_type, source_id, match_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'admin', ?, NULL, ?, ?)`
      )
      .run(input.playerId, input.gameId, delta, before, after, input.sourceId ?? null, input.idempotencyKey, now);

    if (inserted.changes === 0) {
      const existing = findTransaction(input.idempotencyKey);
      return {
        applied: false,
        alreadyProcessed: true,
        transactionId: null,
        profile: getProfile(input.playerId, input.gameId) ?? profile,
        delta: existing?.delta ?? 0,
        ratingBefore: existing?.rating_before ?? before,
        ratingAfter: existing?.rating_after ?? before,
      };
    }

    db.prepare(
      'UPDATE competitive_profiles SET elo = ?, updated_at = ? WHERE player_id = ? AND game_id = ?'
    ).run(after, now, input.playerId, input.gameId);

    const updated = getProfile(input.playerId, input.gameId);
    if (!updated) throw new Error('eloService: profile disappeared during update');

    return {
      applied: true,
      alreadyProcessed: false,
      transactionId: Number(inserted.lastInsertRowid),
      profile: updated,
      delta,
      ratingBefore: before,
      ratingAfter: after,
    };
  });

  return tx();
}
