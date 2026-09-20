/**
 * Phase 2.z — pure Global Competitive XP engine tests.
 * Run: `ts-node src/competitive/competitiveXpEngine.test.ts`.
 */

import { assertEqual, assertThrows, summarize, test } from './testHarness';
import { XP_DRAW, XP_LOSS, XP_WIN, computeXpForResult } from './competitiveXpEngine';
import type { CompetitiveResult } from './types';

console.log('=== competitiveXpEngine ===');

test('loss = 25', () => {
  assertEqual(XP_LOSS, 25, 'constant');
  assertEqual(computeXpForResult('loss'), 25, 'value');
});

test('draw = 35', () => {
  assertEqual(XP_DRAW, 35, 'constant');
  assertEqual(computeXpForResult('draw'), 35, 'value');
});

test('win = 50', () => {
  assertEqual(XP_WIN, 50, 'constant');
  assertEqual(computeXpForResult('win'), 50, 'value');
});

test('unsupported result throws', () => {
  assertThrows(() => computeXpForResult('lose' as unknown as CompetitiveResult), 'invalid');
});

summarize('competitiveXpEngine');
