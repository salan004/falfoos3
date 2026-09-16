/**
 * Phase 4A — unit tests for the 18-level rank system.
 * Run: `npm -w server run test` (or `ts-node src/competitive/ranks.test.ts`).
 */

import { computeRank, getRankDefinition, LP_PER_LEVEL, RANKS, TOTAL_RANKS } from './ranks';
import { assertEqual, assertInteger, assertNull, assertTrue, summarize, test } from './testHarness';

const BOUNDARIES: { lp: number; rankKey: string }[] = [
  { lp: 0, rankKey: 'bronze_3' },
  { lp: 99, rankKey: 'bronze_3' },
  { lp: 100, rankKey: 'bronze_2' },
  { lp: 199, rankKey: 'bronze_2' },
  { lp: 200, rankKey: 'bronze_1' },
  { lp: 299, rankKey: 'bronze_1' },
  { lp: 300, rankKey: 'silver_3' },
  { lp: 399, rankKey: 'silver_3' },
  { lp: 400, rankKey: 'silver_2' },
  { lp: 499, rankKey: 'silver_2' },
  { lp: 500, rankKey: 'silver_1' },
  { lp: 599, rankKey: 'silver_1' },
  { lp: 600, rankKey: 'gold_3' },
  { lp: 699, rankKey: 'gold_3' },
  { lp: 700, rankKey: 'gold_2' },
  { lp: 799, rankKey: 'gold_2' },
  { lp: 800, rankKey: 'gold_1' },
  { lp: 899, rankKey: 'gold_1' },
  { lp: 900, rankKey: 'platinum_3' },
  { lp: 999, rankKey: 'platinum_3' },
  { lp: 1000, rankKey: 'platinum_2' },
  { lp: 1099, rankKey: 'platinum_2' },
  { lp: 1100, rankKey: 'platinum_1' },
  { lp: 1199, rankKey: 'platinum_1' },
  { lp: 1200, rankKey: 'diamond_3' },
  { lp: 1299, rankKey: 'diamond_3' },
  { lp: 1300, rankKey: 'diamond_2' },
  { lp: 1399, rankKey: 'diamond_2' },
  { lp: 1400, rankKey: 'diamond_1' },
  { lp: 1499, rankKey: 'diamond_1' },
  { lp: 1500, rankKey: 'legendary_3' },
  { lp: 1599, rankKey: 'legendary_3' },
  { lp: 1600, rankKey: 'legendary_2' },
  { lp: 1699, rankKey: 'legendary_2' },
  { lp: 1700, rankKey: 'legendary_1' },
  { lp: 1800, rankKey: 'legendary_1' },
  { lp: 2500, rankKey: 'legendary_1' },
];

console.log('=== Rank System ===');

test('defines exactly 18 ranks in progression order', () => {
  assertEqual(RANKS.length, TOTAL_RANKS, 'rank count');
  assertEqual(RANKS.length, 18, 'rank count literal');
  const first = RANKS[0];
  const last = RANKS[RANKS.length - 1];
  assertEqual(first.rankKey, 'bronze_3', 'lowest rank');
  assertEqual(last.rankKey, 'legendary_1', 'highest rank');
  assertEqual(first.levelIndex, 1, 'first levelIndex');
  assertEqual(last.levelIndex, 18, 'last levelIndex');
});

test('every level spans exactly 100 LP and levelIndex matches order', () => {
  RANKS.forEach((rank, i) => {
    assertEqual(rank.levelIndex, i + 1, `levelIndex for ${rank.rankKey}`);
    assertEqual(rank.threshold, i * LP_PER_LEVEL, `threshold for ${rank.rankKey}`);
    if (i < TOTAL_RANKS - 1) {
      assertEqual(rank.nextThreshold, rank.threshold + LP_PER_LEVEL, `nextThreshold for ${rank.rankKey}`);
    } else {
      assertNull(rank.nextThreshold, `nextThreshold for ${rank.rankKey}`);
    }
  });
});

for (const { lp, rankKey } of BOUNDARIES) {
  test(`LP ${lp} -> ${rankKey}`, () => {
    assertEqual(computeRank(lp).rankKey, rankKey, `rank at ${lp} LP`);
  });
}

test('division 1 is the highest within a tier', () => {
  const gold1 = getRankDefinition('gold_1');
  const gold2 = getRankDefinition('gold_2');
  const gold3 = getRankDefinition('gold_3');
  assertTrue(!!gold1 && !!gold2 && !!gold3, 'gold ranks exist');
  assertTrue(gold1!.levelIndex > gold2!.levelIndex && gold2!.levelIndex > gold3!.levelIndex, 'gold ordering');
  assertEqual(gold1!.division, 1, 'gold_1 division');
  assertEqual(gold3!.division, 3, 'gold_3 division');
});

test('mid-level progress values are exact', () => {
  const mid = computeRank(150);
  assertEqual(mid.rankKey, 'bronze_2', 'rank at 150');
  assertEqual(mid.currentThreshold, 100, 'currentThreshold');
  assertEqual(mid.nextThreshold, 200, 'nextThreshold');
  assertEqual(mid.lpIntoLevel, 50, 'lpIntoLevel');
  assertEqual(mid.lpForNext, 50, 'lpForNext');
  assertEqual(mid.progressPct, 50, 'progressPct');
});

test('Legendary 1 represents an unbounded top rank', () => {
  const top = computeRank(1700);
  assertEqual(top.rankKey, 'legendary_1', 'rank at 1700');
  assertEqual(top.currentThreshold, 1700, 'currentThreshold');
  assertNull(top.nextThreshold, 'nextThreshold');
  assertNull(top.lpForNext, 'lpForNext');
  assertEqual(top.lpIntoLevel, 0, 'lpIntoLevel at 1700');
  assertEqual(top.progressPct, 100, 'progressPct at 1700');

  const far = computeRank(2500);
  assertEqual(far.rankKey, 'legendary_1', 'rank at 2500');
  assertEqual(far.lpIntoLevel, 800, 'lpIntoLevel at 2500');
  assertEqual(far.progressPct, 100, 'progressPct at 2500');
});

test('LP can never produce an invalid rank (sweep + hostile inputs)', () => {
  for (let lp = -50; lp <= 3000; lp += 7) {
    const rank = computeRank(lp);
    assertTrue(RANKS.some((r) => r.rankKey === rank.rankKey), `known rankKey at ${lp}`);
    assertInteger(rank.levelIndex, 'levelIndex');
    assertTrue(rank.levelIndex >= 1 && rank.levelIndex <= 18, `levelIndex range at ${lp}`);
    assertTrue([1, 2, 3].includes(rank.division), `division at ${lp}`);
    assertTrue(rank.nextThreshold === null || rank.nextThreshold === rank.currentThreshold + 100, `nextThreshold at ${lp}`);
  }

  for (const hostile of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -500]) {
    const rank = computeRank(hostile);
    assertEqual(rank.rankKey, 'bronze_3', `hostile ${String(hostile)}`);
    assertEqual(rank.currentThreshold, 0, `hostile ${String(hostile)} threshold`);
  }

  assertEqual(computeRank(12.7).rankKey, 'bronze_3', 'fractional floor');
  assertEqual(computeRank(199.9).rankKey, 'bronze_2', 'fractional floor at boundary');
});

test('getRankDefinition returns definitions and null for unknown keys', () => {
  assertEqual(getRankDefinition('legendary_2')?.levelIndex, 17, 'legendary_2 lookup');
  assertEqual(getRankDefinition('does_not_exist'), null, 'unknown lookup');
});

summarize('ranks');
