/**
 * Phase 2.z — global competitive level curve tests (20 levels).
 * Run: `ts-node src/competitive/competitiveLevel.test.ts`.
 */

import { assertEqual, assertNull, assertTrue, summarize, test } from './testHarness';
import {
  COMPETITIVE_LEVEL_THRESHOLDS,
  COMPETITIVE_MAX_LEVEL,
  computeCompetitiveLevel,
  tierForLevel,
} from './competitiveLevel';

console.log('=== competitiveLevel ===');

test('defines exactly 20 levels with the approved thresholds', () => {
  assertEqual(COMPETITIVE_MAX_LEVEL, 20, 'max level');
  assertEqual(COMPETITIVE_LEVEL_THRESHOLDS.length, 20, 'threshold count');
  const expected = [
    0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2750, 3400, 4150, 5000, 6000, 7200, 8600, 10200, 12000,
    14000, 16500,
  ];
  assertEqual(JSON.stringify([...COMPETITIVE_LEVEL_THRESHOLDS]), JSON.stringify(expected), 'exact thresholds');
});

test('0 XP is Level 1', () => {
  const info = computeCompetitiveLevel(0);
  assertEqual(info.level, 1, 'level');
  assertEqual(info.currentLevelXp, 0, 'current');
  assertEqual(info.nextLevelXp, 100, 'next');
  assertEqual(info.progressPct, 0, 'progress');
  assertEqual(info.isMax, false, 'not max');
});

test('every exact threshold maps to its level', () => {
  COMPETITIVE_LEVEL_THRESHOLDS.forEach((xp, index) => {
    const info = computeCompetitiveLevel(xp);
    assertEqual(info.level, index + 1, `level at ${xp} XP`);
    assertEqual(info.currentLevelXp, xp, `current at ${xp}`);
  });
});

test('values immediately before/after thresholds', () => {
  assertEqual(computeCompetitiveLevel(99).level, 1, '99 → L1');
  assertEqual(computeCompetitiveLevel(100).level, 2, '100 → L2');
  assertEqual(computeCompetitiveLevel(101).level, 2, '101 → L2');
  assertEqual(computeCompetitiveLevel(249).level, 2, '249 → L2');
  assertEqual(computeCompetitiveLevel(250).level, 3, '250 → L3');
});

test('progress percentage is exact within a level', () => {
  const info = computeCompetitiveLevel(150); // L2 (100) → L3 (250): span 150, into 50 ⇒ 33%
  assertEqual(info.level, 2, 'level');
  assertEqual(info.xpIntoLevel, 50, 'into level');
  assertEqual(info.xpForNext, 100, 'for next');
  assertEqual(info.progressPct, 33, 'pct');
});

test('Level 20 caps progress at 100% and never exceeds', () => {
  const at20 = computeCompetitiveLevel(16500);
  assertEqual(at20.level, 20, 'level');
  assertNull(at20.nextLevelXp, 'no next');
  assertEqual(at20.progressPct, 100, 'pct');
  assertEqual(at20.isMax, true, 'isMax');

  const overflow = computeCompetitiveLevel(999999);
  assertEqual(overflow.level, 20, 'capped');
  assertEqual(overflow.progressPct, 100, 'capped pct');
  assertTrue(overflow.xpIntoLevel >= 0, 'xp retained');
});

test('hostile input degrades safely to Level 1', () => {
  assertEqual(computeCompetitiveLevel(-500).level, 1, 'negative');
  assertEqual(computeCompetitiveLevel(Number.NaN).level, 1, 'NaN');
  assertEqual(computeCompetitiveLevel(Number.POSITIVE_INFINITY).level, 1, 'Infinity');
  assertEqual(computeCompetitiveLevel(12.9).level, 1, 'fractional floor');
});

test('visual tiers split 1–5 / 6–10 / 11–15 / 16–20', () => {
  assertEqual(tierForLevel(1), 1, 'L1 tier 1');
  assertEqual(tierForLevel(5), 1, 'L5 tier 1');
  assertEqual(tierForLevel(6), 2, 'L6 tier 2');
  assertEqual(tierForLevel(10), 2, 'L10 tier 2');
  assertEqual(tierForLevel(11), 3, 'L11 tier 3');
  assertEqual(tierForLevel(15), 3, 'L15 tier 3');
  assertEqual(tierForLevel(16), 4, 'L16 tier 4');
  assertEqual(tierForLevel(20), 4, 'L20 tier 4');
});

summarize('competitiveLevel');
