/**
 * Phase 4A — the Elo rating engine.
 *
 * Elo is INDEPENDENT from LP and must never be combined with it. This module
 * implements the standard formula only:
 *
 *   Expected:  E  = 1 / (1 + 10^((Rb - Ra) / 400))
 *   Updated:   R' = R + K * (S - E)     with S in {1, 0.5, 0}
 *
 * Pure and deterministic: no DB, no services, no UI. A future service will
 * persist the result inside a transaction. Phase 4A targets 1v1 matches; the
 * engine is shaped around per-opponent calculations so multi-player support can
 * be layered on later without a rewrite.
 */

import type { CompetitiveResult } from './types';

/** Default rating a competitive profile starts at (configurable, never a DB constant). */
export const DEFAULT_INITIAL_ELO = 1200;
/** Default K-factor (configurable, never derived from UI or DB state). */
export const DEFAULT_K_FACTOR = 32;

export interface EloConfig {
  /** Rating sensitivity per match. */
  kFactor: number;
  /** Starting rating for a new competitive profile. */
  initialRating: number;
}

export interface EloCalculation {
  rating: number;
  opponentRating: number;
  result: CompetitiveResult;
  /** Expected score for `rating` versus `opponentRating`, in [0, 1]. */
  expectedScore: number;
  /** Signed, rounded rating change. */
  delta: number;
  newRating: number;
  kFactor: number;
}

export interface EloMatchCalculation {
  playerA: EloCalculation;
  playerB: EloCalculation;
}

export const DEFAULT_ELO_CONFIG: EloConfig = Object.freeze({
  kFactor: DEFAULT_K_FACTOR,
  initialRating: DEFAULT_INITIAL_ELO,
});

function assertFinite(value: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`eloEngine: ${name} must be a finite number`);
  }
}

function assertKFactor(kFactor: number): void {
  if (typeof kFactor !== 'number' || !Number.isFinite(kFactor) || kFactor <= 0) {
    throw new Error('eloEngine: kFactor must be a positive finite number');
  }
}

/** Resolves a partial config against the defaults. */
export function resolveEloConfig(config?: Partial<EloConfig>): EloConfig {
  return {
    kFactor: config?.kFactor ?? DEFAULT_K_FACTOR,
    initialRating: config?.initialRating ?? DEFAULT_INITIAL_ELO,
  };
}

/** Actual score for a competitive result. Throws on an unsupported value. */
export function scoreForResult(result: CompetitiveResult): number {
  switch (result) {
    case 'win':
      return 1;
    case 'draw':
      return 0.5;
    case 'loss':
      return 0;
    default:
      throw new Error(`scoreForResult: unsupported competitive result "${String(result)}"`);
  }
}

/** Inverts a result for the opponent's perspective. */
export function invertResult(result: CompetitiveResult): CompetitiveResult {
  switch (result) {
    case 'win':
      return 'loss';
    case 'loss':
      return 'win';
    case 'draw':
      return 'draw';
    default:
      throw new Error(`invertResult: unsupported competitive result "${String(result)}"`);
  }
}

/**
 * Symmetric rounding (half away from zero). Using one deterministic rule for
 * both players keeps a 1v1 rating change exactly zero-sum: equal-magnitude
 * deltas of opposite sign round to exact negatives.
 */
function roundElo(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Standard expected score for `rating` against `opponentRating`. */
export function expectedScore(rating: number, opponentRating: number): number {
  assertFinite(rating, 'rating');
  assertFinite(opponentRating, 'opponentRating');
  return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

/** Signed, rounded Elo delta for a single rating against one opponent. */
export function computeEloDelta(
  rating: number,
  opponentRating: number,
  result: CompetitiveResult,
  kFactor: number = DEFAULT_K_FACTOR
): number {
  assertKFactor(kFactor);
  const expected = expectedScore(rating, opponentRating);
  const actual = scoreForResult(result);
  return roundElo(kFactor * (actual - expected));
}

/** Full calculation for one rating against one opponent. */
export function computeElo(
  rating: number,
  opponentRating: number,
  result: CompetitiveResult,
  config?: Partial<EloConfig>
): EloCalculation {
  const resolved = resolveEloConfig(config);
  assertKFactor(resolved.kFactor);
  const expected = expectedScore(rating, opponentRating);
  const actual = scoreForResult(result);
  const delta = roundElo(resolved.kFactor * (actual - expected));

  return {
    rating,
    opponentRating,
    result,
    expectedScore: expected,
    delta,
    newRating: rating + delta,
    kFactor: resolved.kFactor,
  };
}

/**
 * Calculates both sides of a 1v1 match. Each side is evaluated independently
 * (own expected score), then player B is anchored to player A's rounded delta
 * so the invariant `deltaA + deltaB = 0` holds exactly regardless of rounding.
 */
export function computeMatchElo(
  ratingA: number,
  ratingB: number,
  resultA: CompetitiveResult,
  config?: Partial<EloConfig>
): EloMatchCalculation {
  const playerA = computeElo(ratingA, ratingB, resultA, config);
  const resultB = invertResult(resultA);
  const playerBBase = computeElo(ratingB, ratingA, resultB, config);
  const playerB: EloCalculation = {
    ...playerBBase,
    delta: -playerA.delta,
    newRating: ratingB - playerA.delta,
  };
  return { playerA, playerB };
}

/** One side of a team match: every member's individual rating and Elo delta. */
export interface TeamEloSideCalculation {
  ratings: number[];
  deltas: number[];
  newRatings: number[];
}

export interface TeamEloMatchCalculation {
  playerA: TeamEloSideCalculation;
  playerB: TeamEloSideCalculation;
  /** Sum of every member delta across BOTH sides. Always exactly 0. */
  totalDelta: number;
}

function teamSideCalculation(
  ratings: number[],
  opponentRatings: number[],
  result: CompetitiveResult,
  kFactor: number
): TeamEloSideCalculation {
  // Each member's delta is the SUM of their individual 1v1 exchanges against
  // every member of the opposing team, using the existing `computeEloDelta`.
  // Because each pairwise exchange is exactly zero-sum (symmetric rounding),
  // the aggregate over both sides is exactly zero for ANY team sizes.
  const deltas = ratings.map((rating) =>
    opponentRatings.reduce(
      (sum, opponentRating) => sum + computeEloDelta(rating, opponentRating, result, kFactor),
      0
    )
  );
  return {
    ratings,
    deltas,
    newRatings: ratings.map((rating, index) => rating + deltas[index]),
  };
}

/**
 * Zero-sum Elo for a team match (Team vs Team / 2v2), grounded in the existing
 * 1v1 engine.
 *
 * There is NO team rating and NO team Elo: Elo remains a property of each
 * individual player. Each member's delta is the sum of the standard pairwise
 * `computeEloDelta` exchanges against the opposing team's members. Since every
 * pairwise exchange satisfies `d(a,b) + d(b,a) = 0` under the engine's symmetric
 * rounding, the aggregate `SUM(winning deltas) + SUM(losing deltas)` is exactly
 * zero regardless of team sizes or the players' ratings.
 *
 * This is a strict generalization of `computeMatchElo`: with one player per
 * side it produces the identical zero-sum 1v1 result.
 */
export function computeTeamMatchElo(
  ratingsA: number[],
  ratingsB: number[],
  resultA: CompetitiveResult,
  config?: Partial<EloConfig>
): TeamEloMatchCalculation {
  const resolved = resolveEloConfig(config);
  assertKFactor(resolved.kFactor);
  if (ratingsA.length === 0 || ratingsB.length === 0) {
    throw new Error('eloEngine: a team match requires at least one player per side');
  }
  const resultB = invertResult(resultA);
  const playerA = teamSideCalculation(ratingsA, ratingsB, resultA, resolved.kFactor);
  const playerB = teamSideCalculation(ratingsB, ratingsA, resultB, resolved.kFactor);
  const totalDelta =
    playerA.deltas.reduce((sum, delta) => sum + delta, 0) +
    playerB.deltas.reduce((sum, delta) => sum + delta, 0);
  return { playerA, playerB, totalDelta };
}
