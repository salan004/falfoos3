/**
 * Phase 2.z — the pure Global Competitive XP engine (Model C: Match + Result).
 *
 * XP is GLOBAL and independent of LP/Elo/rank. It is awarded for completing a
 * competitive match and never penalised (a loss still grants XP):
 *
 *   loss = 25, draw = 35, win = 50
 *
 * Pure and deterministic: no DB, no services, no side effects. Persistence and
 * idempotency belong to `GlobalProgressionService`.
 */

import { isCompetitiveResult } from './lpEngine';
import type { CompetitiveResult } from './types';

/** Approved XP awards — do not change. */
export const XP_LOSS = 25;
export const XP_DRAW = 35;
export const XP_WIN = 50;

const XP_BY_RESULT: Record<CompetitiveResult, number> = {
  win: XP_WIN,
  draw: XP_DRAW,
  loss: XP_LOSS,
};

/** Global XP granted for one completed competitive match result. */
export function computeXpForResult(result: CompetitiveResult): number {
  if (!isCompetitiveResult(result)) {
    throw new Error(`competitiveXpEngine: unsupported result "${String(result)}"`);
  }
  return XP_BY_RESULT[result];
}
