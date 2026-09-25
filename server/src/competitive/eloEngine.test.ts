/**
 * Phase 4A — unit tests for the Elo engine.
 * Run: `npm -w server run test` (or `ts-node src/competitive/eloEngine.test.ts`).
 */

import {
  computeElo,
  computeEloDelta,
  computeMatchElo,
  computeTeamMatchElo,
  DEFAULT_INITIAL_ELO,
  DEFAULT_K_FACTOR,
  expectedScore,
  invertResult,
  resolveEloConfig,
  scoreForResult,
} from './eloEngine';
import type { CompetitiveResult } from './types';
import { assertClose, assertEqual, assertInteger, assertThrows, assertTrue, summarize, test } from './testHarness';

console.log('=== Elo Engine ===');

test('defaults: initial Elo 1200, K-factor 32', () => {
  assertEqual(DEFAULT_INITIAL_ELO, 1200, 'default initial Elo');
  assertEqual(DEFAULT_K_FACTOR, 32, 'default K-factor');
  const cfg = resolveEloConfig();
  assertEqual(cfg.initialRating, 1200, 'resolved initialRating');
  assertEqual(cfg.kFactor, 32, 'resolved kFactor');
  const custom = resolveEloConfig({ kFactor: 16, initialRating: 1000 });
  assertEqual(custom.kFactor, 16, 'custom kFactor');
  assertEqual(custom.initialRating, 1000, 'custom initialRating');
});

test('expected score basics', () => {
  assertClose(expectedScore(1200, 1200), 0.5, 1e-12, 'equal ratings');
  assertTrue(expectedScore(1600, 1200) > 0.5, 'favorite expected > 0.5');
  assertTrue(expectedScore(1200, 1600) < 0.5, 'underdog expected < 0.5');
  assertClose(expectedScore(1600, 1200) + expectedScore(1200, 1600), 1, 1e-12, 'symmetric sum');
});

test('equal-rating win / loss / draw', () => {
  const win = computeElo(1200, 1200, 'win');
  assertEqual(win.delta, 16, 'equal win delta');
  assertEqual(win.newRating, 1216, 'equal win new rating');

  const loss = computeElo(1200, 1200, 'loss');
  assertEqual(loss.delta, -16, 'equal loss delta');
  assertEqual(loss.newRating, 1184, 'equal loss new rating');

  const draw = computeElo(1200, 1200, 'draw');
  assertEqual(draw.delta, 0, 'equal draw delta');
  assertEqual(draw.newRating, 1200, 'equal draw new rating');
});

test('favorite gains less than underdog for the same win', () => {
  const favoriteWins = computeEloDelta(1400, 1200, 'win');
  const underdogWins = computeEloDelta(1200, 1400, 'win');
  assertTrue(favoriteWins > 0, 'favorite win is positive');
  assertTrue(underdogWins > 0, 'underdog win is positive');
  assertTrue(underdogWins > favoriteWins, 'upset rewards more than expected win');
  assertTrue(computeEloDelta(1400, 1200, 'loss') < 0, 'favorite loss is negative');
});

test('K-factor is configurable', () => {
  assertEqual(computeEloDelta(1200, 1200, 'win', 16), 8, 'K=16 equal win');
  assertEqual(computeEloDelta(1200, 1200, 'win', 64), 32, 'K=64 equal win');
  assertEqual(computeElo(1200, 1200, 'win', { kFactor: 16 }).kFactor, 16, 'kFactor reported');
});

test('1v1 match changes are exactly zero-sum for win/loss/draw', () => {
  const pairs: [number, number][] = [
    [1200, 1200],
    [1400, 1200],
    [1200, 1400],
    [1000, 1800],
    [1750, 1210],
  ];
  const results: CompetitiveResult[] = ['win', 'loss', 'draw'];

  for (const [ratingA, ratingB] of pairs) {
    for (const result of results) {
      const match = computeMatchElo(ratingA, ratingB, result);
      assertEqual(match.playerA.delta + match.playerB.delta, 0, `zero-sum ${ratingA}/${ratingB}/${result}`);
      assertEqual(match.playerB.delta, -match.playerA.delta, `mirrored delta ${ratingA}/${ratingB}/${result}`);
      assertEqual(match.playerA.newRating, ratingA + match.playerA.delta, `A consistency ${ratingA}/${result}`);
      assertEqual(match.playerB.newRating, ratingB + match.playerB.delta, `B consistency ${ratingB}/${result}`);
      assertClose(match.playerA.expectedScore + match.playerB.expectedScore, 1, 1e-9, `expected symmetry ${ratingA}/${ratingB}`);
    }
  }
});

test('winner/loser deltas are consistent around equal ratings', () => {
  const match = computeMatchElo(1200, 1200, 'win');
  assertEqual(match.playerA.delta, 16, 'winner delta');
  assertEqual(match.playerB.delta, -16, 'loser delta');
  assertEqual(match.playerA.newRating, 1216, 'winner new rating');
  assertEqual(match.playerB.newRating, 1184, 'loser new rating');
  assertEqual(
    match.playerA.newRating + match.playerB.newRating,
    2400,
    'total rating is conserved'
  );
});

test('rounding is consistent and never introduces asymmetric deltas', () => {
  for (let ratingA = 900; ratingA <= 2100; ratingA += 37) {
    for (let ratingB = 900; ratingB <= 2100; ratingB += 53) {
      for (const result of ['win', 'loss', 'draw'] as CompetitiveResult[]) {
        const match = computeMatchElo(ratingA, ratingB, result);
        assertInteger(match.playerA.delta, `A delta integer ${ratingA}/${ratingB}/${result}`);
        assertInteger(match.playerB.delta, `B delta integer ${ratingA}/${ratingB}/${result}`);
        assertEqual(match.playerA.delta + match.playerB.delta, 0, `zero-sum sweep ${ratingA}/${ratingB}/${result}`);
      }
    }
  }
});

test('team Elo: reduces to the exact 1v1 match result for a single player per side', () => {
  for (const [a, b] of [[1200, 1200], [1400, 1200], [1000, 1800]] as [number, number][]) {
    for (const result of ['win', 'loss', 'draw'] as CompetitiveResult[]) {
      const team = computeTeamMatchElo([a], [b], result);
      const duel = computeMatchElo(a, b, result);
      assertEqual(team.playerA.deltas[0], duel.playerA.delta, `A delta parity ${a}/${b}/${result}`);
      assertEqual(team.playerB.deltas[0], duel.playerB.delta, `B delta parity ${a}/${b}/${result}`);
      assertEqual(team.totalDelta, 0, `zero-sum 1v1 ${a}/${b}/${result}`);
    }
  }
});

test('team Elo: aggregate delta is exactly zero for any team sizes and ratings', () => {
  const cases: [number[], number[]][] = [
    [[1200, 1200], [1200, 1200]],           // 2v2 equal
    [[1500, 1100], [1300, 1300]],           // 2v2 mixed
    [[1500, 1100, 900], [1300, 1300]],      // 3v2 (unequal)
    [[1000], [1800, 1700, 1600, 1500]],     // 1v4 (unequal)
    [[2000, 800, 1200, 1200, 900], [1400, 1400, 1000, 1000, 1000]], // 5v5
  ];
  for (const [ratingsA, ratingsB] of cases) {
    for (const result of ['win', 'loss', 'draw'] as CompetitiveResult[]) {
      const match = computeTeamMatchElo(ratingsA, ratingsB, result);
      const sumA = match.playerA.deltas.reduce((s, d) => s + d, 0);
      const sumB = match.playerB.deltas.reduce((s, d) => s + d, 0);
      assertEqual(sumA + sumB, 0, `zero-sum ${JSON.stringify(ratingsA)} vs ${JSON.stringify(ratingsB)}/${result}`);
      assertEqual(match.totalDelta, 0, `reported total zero ${result}`);
      assertInteger(sumA, `winner-side aggregate integer ${result}`);
      // Winner side gains, loser side loses for a decisive result.
      if (result === 'win') {
        assertTrue(sumA > 0 && sumB < 0, 'winning side gains, losing side loses');
      }
    }
  }
});

test('team Elo: each member delta is the sum of pairwise 1v1 exchanges', () => {
  const winners = [1400, 1100];
  const losers = [1200, 1300, 1000];
  const match = computeTeamMatchElo(winners, losers, 'win');
  winners.forEach((rating, i) => {
    const expected = losers.reduce((sum, opp) => sum + computeEloDelta(rating, opp, 'win'), 0);
    assertEqual(match.playerA.deltas[i], expected, `member ${i} equals pairwise sum`);
  });
  losers.forEach((rating, i) => {
    const expected = winners.reduce((sum, opp) => sum + computeEloDelta(rating, opp, 'loss'), 0);
    assertEqual(match.playerB.deltas[i], expected, `opponent ${i} equals pairwise sum`);
  });
});

test('team Elo: rejects an empty side', () => {
  assertThrows(() => computeTeamMatchElo([], [1200], 'win'), 'empty winning side');
  assertThrows(() => computeTeamMatchElo([1200], [], 'win'), 'empty losing side');
});

test('result helpers: score and inversion', () => {
  assertEqual(scoreForResult('win'), 1, 'win score');
  assertEqual(scoreForResult('draw'), 0.5, 'draw score');
  assertEqual(scoreForResult('loss'), 0, 'loss score');
  assertEqual(invertResult('win'), 'loss', 'invert win');
  assertEqual(invertResult('loss'), 'win', 'invert loss');
  assertEqual(invertResult('draw'), 'draw', 'invert draw');
});

test('unsupported inputs throw', () => {
  assertThrows(() => computeEloDelta(1200, 1200, 'win', 0), 'kFactor 0');
  assertThrows(() => computeEloDelta(1200, 1200, 'win', -5), 'kFactor negative');
  assertThrows(() => computeEloDelta(1200, 1200, 'win', Number.NaN), 'kFactor NaN');
  assertThrows(() => computeElo(1200, 1200, 'lose' as unknown as CompetitiveResult), 'invalid result');
  assertThrows(() => scoreForResult('' as unknown as CompetitiveResult), 'empty result');
  assertThrows(() => expectedScore(Number.NaN, 1200), 'NaN rating');
  assertThrows(() => expectedScore(1200, Number.POSITIVE_INFINITY), 'infinite opponent rating');
});

summarize('eloEngine');
