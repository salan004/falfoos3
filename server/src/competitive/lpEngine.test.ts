/**
 * Phase 4A — unit tests for the LP engine (+25 / -20 / 0, floored at zero).
 * Run: `npm -w server run test` (or `ts-node src/competitive/lpEngine.test.ts`).
 */

import { applyLp, computeLpDelta, isCompetitiveResult, LP_DRAW, LP_LOSS, LP_WIN } from './lpEngine';
import type { CompetitiveResult } from './types';
import { assertEqual, assertTrue, assertThrows, summarize, test, assertClose } from './testHarness';

console.log('=== LP Engine ===');

test('base deltas: win +25, loss -20, draw 0', () => {
  assertEqual(computeLpDelta('win'), 25, 'win delta');
  assertEqual(computeLpDelta('loss'), -20, 'loss delta');
  assertEqual(computeLpDelta('draw'), 0, 'draw delta');
  assertEqual(LP_WIN, 25, 'LP_WIN constant');
  assertEqual(LP_LOSS, -20, 'LP_LOSS constant');
  assertEqual(LP_DRAW, 0, 'LP_DRAW constant');
});

test('loss floors LP at zero', () => {
  assertEqual(applyLp(0, 'loss').newLp, 0, '0 LP + loss');
  assertEqual(applyLp(10, 'loss').newLp, 0, '10 LP + loss');
  assertEqual(applyLp(20, 'loss').newLp, 0, '20 LP + loss');
  assertEqual(applyLp(25, 'loss').newLp, 5, '25 LP + loss');
});

test('floored losses are flagged and unfloored losses are not', () => {
  const floored = applyLp(10, 'loss');
  assertTrue(floored.clampedAtZero, 'clampedAtZero true at 10 LP + loss');
  assertEqual(floored.delta, -20, 'delta preserved even when floored');
  assertEqual(floored.previousLp, 10, 'previousLp preserved');

  const exact = applyLp(20, 'loss');
  assertTrue(!exact.clampedAtZero, 'clampedAtZero false at 20 LP + loss (lands exactly on 0, no clamp needed)');
  assertEqual(exact.newLp, 0, 'newLp at 20 LP + loss');

  const justBelow = applyLp(19, 'loss');
  assertTrue(justBelow.clampedAtZero, 'clampedAtZero true at 19 LP + loss');
  assertEqual(justBelow.newLp, 0, 'newLp at 19 LP + loss');

  const normal = applyLp(25, 'loss');
  assertTrue(!normal.clampedAtZero, 'clampedAtZero false at 25 LP + loss');
  assertEqual(normal.newLp, 5, 'newLp at 25 LP + loss');
});

test('wins and draws produce expected balances', () => {
  assertEqual(applyLp(100, 'win').newLp, 125, '100 LP + win');
  assertEqual(applyLp(100, 'loss').newLp, 80, '100 LP + loss');
  assertEqual(applyLp(100, 'draw').newLp, 100, '100 LP + draw');
  assertEqual(applyLp(0, 'win').newLp, 25, '0 LP + win');
  assertEqual(applyLp(0, 'draw').newLp, 0, '0 LP + draw');
});

test('applyLp normalizes hostile input and never returns negative LP', () => {
  assertEqual(applyLp(Number.NaN, 'win').newLp, 25, 'NaN input');
  assertEqual(applyLp(-100, 'win').newLp, 25, 'negative input');
  assertEqual(applyLp(33.9, 'win').newLp, 58, 'fractional input floors');
  for (const result of ['win', 'loss', 'draw'] as CompetitiveResult[]) {
    for (let lp = -20; lp <= 200; lp += 3) {
      assertTrue(applyLp(lp, result).newLp >= 0, `non-negative LP for ${result} at ${lp}`);
    }
  }
});

test('computeLpDelta is deterministic', () => {
  assertClose(computeLpDelta('win'), computeLpDelta('win'), 0, 'win determinism');
  const first = applyLp(137, 'loss');
  const second = applyLp(137, 'loss');
  assertEqual(first.newLp, second.newLp, 'applyLp determinism');
  assertEqual(first.delta, second.delta, 'delta determinism');
});

test('unsupported results throw instead of yielding a wrong delta', () => {
  assertThrows(() => computeLpDelta('lose' as unknown as CompetitiveResult), 'computeLpDelta invalid');
  assertThrows(() => computeLpDelta('' as unknown as CompetitiveResult), 'computeLpDelta empty');
  assertThrows(() => applyLp(100, 'winning' as unknown as CompetitiveResult), 'applyLp invalid');
});

test('isCompetitiveResult guards the union', () => {
  assertTrue(isCompetitiveResult('win'), 'win');
  assertTrue(isCompetitiveResult('loss'), 'loss');
  assertTrue(isCompetitiveResult('draw'), 'draw');
  assertTrue(!isCompetitiveResult('W'), 'uppercase rejected');
  assertTrue(!isCompetitiveResult(null), 'null rejected');
});

summarize('lpEngine');
