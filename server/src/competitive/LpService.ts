/**
 * Phase 4B — LpService.
 *
 * Persists LP changes through the Phase 4A pure engine (`computeLpDelta`) into
 * the immutable `lp_transactions` ledger and the materialized
 * `competitive_profiles.lp` row.
 *
 * The ledger insert and the profile update happen in ONE better-sqlite3
 * transaction: if either fails, neither persists. Duplicate submissions are
 * guarded by the `lp_transactions.idempotency_key` UNIQUE constraint (the
 * authoritative protection) rather than a check-then-insert race.
 *
 * Design note on zero-value changes: a draw produces a real, auditable
 * `lp_transactions` row with `amount = 0` and `balance_before = balance_after`.
 * This keeps a complete per-match ledger without implying any LP gain.
 *
 * No match orchestration, no HTTP, no sockets, no UI. A future
 * `CompetitiveService.processMatchResult(...)` should compose
 * `LpService.applyLpResult` with `EloService.applyEloResult` and
 * `CompetitiveProfileService.applyResultStats` inside one outer transaction.
 */

import { getDb } from '../db/db';
import { computeLpDelta, isCompetitiveResult } from './lpEngine';
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

export interface LpApplyResult {
  /** True only when this call inserted the ledger row and moved LP. */
  applied: boolean;
  /** True when the idempotency key already existed (no double application). */
  alreadyProcessed: boolean;
  /** Row id of the ledger transaction this call created (null when duplicate). */
  transactionId: number | null;
  /** Materialized profile after the call. */
  profile: CompetitiveProfileRow;
  /** Effective LP change (balance_after - balance_before). */
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reason: string;
}

export interface ApplyLpResultInput {
  playerId: string;
  gameId: string;
  result: CompetitiveResult;
  /** Defaults to 'match'. 'tournament' is reserved for future use. */
  sourceType?: CompetitiveSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  reason?: string;
  matchId?: string | null;
  tournamentId?: string | null;
}

export interface ApplyLpDeltaInput {
  playerId: string;
  gameId: string;
  /** Signed requested delta. Effective amount may be smaller when floored at 0. */
  delta: number;
  reason: string;
  sourceType: CompetitiveSourceType;
  sourceId?: string | null;
  idempotencyKey: string;
  matchId?: string | null;
  tournamentId?: string | null;
}

export interface ApplyAdminLpAdjustmentInput {
  playerId: string;
  gameId: string;
  /** Signed LP adjustment. Positive or negative; never edits historical rows. */
  amount: number;
  idempotencyKey: string;
  reason?: string;
  sourceId?: string | null;
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`lpService: ${name} must be a non-empty string`);
  }
}

function assertSourceType(value: unknown): asserts value is CompetitiveSourceType {
  if (typeof value !== 'string' || !SOURCE_TYPES.includes(value as CompetitiveSourceType)) {
    throw new Error(`lpService: unsupported sourceType "${String(value)}"`);
  }
}

interface LpTransactionRow {
  id: number;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
}

function findTransaction(idempotencyKey: string): LpTransactionRow | null {
  const row = getDb()
    .prepare(
      'SELECT id, amount, balance_before, balance_after, reason FROM lp_transactions WHERE idempotency_key = ?'
    )
    .get(idempotencyKey) as LpTransactionRow | undefined;
  return row ?? null;
}

/**
 * Low-level ledger primitive. Used directly for compensating entries
 * (`sourceType: 'correction' | 'reversal'`); higher-level callers use
 * `applyLpResult` or `applyAdminLpAdjustment`.
 */
export function applyLpDelta(input: ApplyLpDeltaInput): LpApplyResult {
  assertNonEmptyString(input.playerId, 'playerId');
  assertNonEmptyString(input.gameId, 'gameId');
  assertNonEmptyString(input.idempotencyKey, 'idempotencyKey');
  assertSourceType(input.sourceType);
  if (typeof input.delta !== 'number' || !Number.isFinite(input.delta)) {
    throw new Error('lpService: delta must be a finite number');
  }
  const delta = Math.trunc(input.delta);

  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): LpApplyResult => {
    const profile = getOrCreateProfile(input.playerId, input.gameId);
    const before = profile.lp;
    // LP must never become negative.
    const after = Math.max(0, before + delta);
    const amount = after - before;

    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO lp_transactions
           (player_id, game_id, amount, balance_before, balance_after, reason,
            source_type, source_id, tournament_id, match_id, idempotency_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.playerId,
        input.gameId,
        amount,
        before,
        after,
        input.reason,
        input.sourceType,
        input.sourceId ?? null,
        input.tournamentId ?? null,
        input.matchId ?? null,
        input.idempotencyKey,
        now
      );

    if (inserted.changes === 0) {
      // Idempotent no-op: the database unique constraint is authoritative.
      const existing = findTransaction(input.idempotencyKey);
      return {
        applied: false,
        alreadyProcessed: true,
        transactionId: null,
        profile: getProfile(input.playerId, input.gameId) ?? profile,
        amount: existing?.amount ?? 0,
        balanceBefore: existing?.balance_before ?? profile.lp,
        balanceAfter: existing?.balance_after ?? profile.lp,
        reason: existing?.reason ?? input.reason,
      };
    }

    db.prepare(
      'UPDATE competitive_profiles SET lp = ?, updated_at = ? WHERE player_id = ? AND game_id = ?'
    ).run(after, now, input.playerId, input.gameId);

    const updated = getProfile(input.playerId, input.gameId);
    if (!updated) throw new Error('lpService: profile disappeared during update');

    return {
      applied: true,
      alreadyProcessed: false,
      transactionId: Number(inserted.lastInsertRowid),
      profile: updated,
      amount,
      balanceBefore: before,
      balanceAfter: after,
      reason: input.reason,
    };
  });

  return tx();
}

/** Applies the official LP result of a completed competitive match. */
export function applyLpResult(input: ApplyLpResultInput): LpApplyResult {
  if (!isCompetitiveResult(input.result)) {
    throw new Error(`lpService: unsupported result "${String(input.result)}"`);
  }
  const delta = computeLpDelta(input.result);
  return applyLpDelta({
    playerId: input.playerId,
    gameId: input.gameId,
    delta,
    reason: input.reason ?? `match_${input.result}`,
    sourceType: input.sourceType ?? 'match',
    sourceId: input.sourceId ?? input.matchId ?? null,
    idempotencyKey: input.idempotencyKey,
    matchId: input.matchId ?? null,
    tournamentId: input.tournamentId ?? null,
  });
}

/**
 * Administrative LP adjustment. Always records an immutable `admin` ledger
 * transaction and never edits history. Positive and negative amounts are both
 * supported; the resulting balance is floored at zero.
 */
export function applyAdminLpAdjustment(input: ApplyAdminLpAdjustmentInput): LpApplyResult {
  if (typeof input.amount !== 'number' || !Number.isFinite(input.amount)) {
    throw new Error('lpService: amount must be a finite number');
  }
  return applyLpDelta({
    playerId: input.playerId,
    gameId: input.gameId,
    delta: input.amount,
    reason: input.reason ?? 'admin_adjustment',
    sourceType: 'admin',
    sourceId: input.sourceId ?? null,
    idempotencyKey: input.idempotencyKey,
  });
}
