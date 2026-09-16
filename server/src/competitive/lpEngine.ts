/**
 * Phase 4A — the LP (Leaderboard Progress Points) calculation engine.
 *
 * LP is independent for every game and is deliberately decoupled from Elo.
 * It changes ONLY from official completed competitive tournament matches.
 * There is no LP for registration, participation, placement, finals/winner
 * bonuses, general live-game play, or cross-game sharing.
 *
 * Pure and deterministic: no DB, no services, no side effects. A future
 * `LpService` will persist the result inside a single transaction.
 */

import type { CompetitiveResult } from './types';
import { normalizeLp } from './ranks';

/** Base LP awarded for a competitive win. */
export const LP_WIN = 25;
/** Base LP applied for a competitive loss (negative). */
export const LP_LOSS = -20;
/** Base LP for a draw. */
export const LP_DRAW = 0;

const LP_BY_RESULT: Record<CompetitiveResult, number> = {
  win: LP_WIN,
  loss: LP_LOSS,
  draw: LP_DRAW,
};

export interface LpDelta {
  result: CompetitiveResult;
  delta: number;
}

export interface LpApplication {
  result: CompetitiveResult;
  /** Normalized LP the player held before the match. */
  previousLp: number;
  /** Signed LP change for this result. */
  delta: number;
  /** Resulting LP, never below zero. */
  newLp: number;
  /** True when a loss would have driven LP below zero and was floored. */
  clampedAtZero: boolean;
}

/** Runtime guard so an unexpected value can never silently yield a wrong delta. */
export function isCompetitiveResult(value: unknown): value is CompetitiveResult {
  return value === 'win' || value === 'loss' || value === 'draw';
}

/** Signed LP delta for a result. Throws on an unsupported result value. */
export function computeLpDelta(result: CompetitiveResult): number {
  if (!isCompetitiveResult(result)) {
    throw new Error(`computeLpDelta: unsupported competitive result "${String(result)}"`);
  }
  return LP_BY_RESULT[result];
}

/**
 * Applies a result to a current LP value, returning the full calculation.
 * LP is floored at zero: a loss at 10 LP yields 0 LP, never -10.
 */
export function applyLp(currentLp: number, result: CompetitiveResult): LpApplication {
  const resultDelta = computeLpDelta(result);
  const previousLp = normalizeLp(currentLp);
  const raw = previousLp + resultDelta;
  const newLp = Math.max(0, raw);

  return {
    result,
    previousLp,
    delta: resultDelta,
    newLp,
    clampedAtZero: raw < 0,
  };
}
