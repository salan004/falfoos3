/**
 * Phase 4B — EloService tests: defaults, win/loss/draw, K-factor, ledger,
 * idempotency, atomicity, cross-game isolation, admin adjustments.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import { cleanCompetitive, countRows, seedGame, seedPlayer } from './competitiveTestSeed';
import { applyAdminEloAdjustment, applyEloResult } from './EloService';
import { getOrCreateProfile, getProfile } from './CompetitiveProfileService';
import { computeElo, DEFAULT_INITIAL_ELO } from './eloEngine';
import type { CompetitiveResult } from './types';
import { assertClose, assertEqual, assertNull, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const P1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const P3 = 'cccccccc-3333-4333-8333-333333333333';
const P4 = 'dddddddd-4444-4444-8444-444444444444';
const P5 = 'eeeeeeee-5555-4555-8555-555555555555';
const P6 = 'ffffffff-6666-4666-8666-666666666666';
const P7 = '77777777-7777-4777-8777-777777777777';
const G1 = 'game-dueling';
const G2 = 'game-rocket';

for (const p of [P1, P2, P3, P4, P5, P6, P7]) seedPlayer(p);
seedGame(G1, 'dueling_grounds');
seedGame(G2, 'rocket_league');
cleanCompetitive();

interface EloRow {
  id: number;
  delta: number;
  rating_before: number;
  rating_after: number;
  opponent_rating_avg: number | null;
  expected_score: number | null;
  k_factor: number | null;
  source_type: string;
  source_id: string | null;
  match_id: string | null;
  idempotency_key: string;
}

function ledger(key: string): EloRow | undefined {
  return getDb().prepare('SELECT * FROM elo_transactions WHERE idempotency_key = ?').get(key) as
    | EloRow
    | undefined;
}

console.log('=== EloService ===');

test('profiles start at the default 1200 Elo with no ledger row', () => {
  const profile = getOrCreateProfile(P1, G1);
  assertEqual(profile.elo, DEFAULT_INITIAL_ELO, 'default elo');
  assertEqual(profile.elo, 1200, 'elo literal');
  assertEqual(countRows('elo_transactions'), 0, 'initialization writes no ledger row');
});

test('equal-rating win awards +16 with a complete ledger row', () => {
  const result = applyEloResult({
    playerId: P1,
    gameId: G1,
    opponentRating: 1200,
    result: 'win',
    idempotencyKey: 'elo:win1',
    matchId: 'match-1',
    sourceId: 'match-1',
  });
  assertTrue(result.applied, 'applied');
  assertEqual(result.delta, 16, 'delta');
  assertEqual(result.ratingBefore, 1200, 'rating before');
  assertEqual(result.ratingAfter, 1216, 'rating after');
  assertEqual(result.profile.elo, 1216, 'profile updated');

  const row = ledger('elo:win1');
  assertTrue(!!row, 'ledger row exists');
  assertEqual(row!.delta, 16, 'ledger delta');
  assertEqual(row!.rating_before, 1200, 'ledger before');
  assertEqual(row!.rating_after, 1216, 'ledger after');
  assertEqual(row!.opponent_rating_avg, 1200, 'ledger opponent');
  assertEqual(row!.k_factor, 32, 'ledger k factor');
  assertEqual(row!.source_type, 'match', 'ledger source type');
  assertEqual(row!.match_id, 'match-1', 'ledger match id');
  assertClose(row!.expected_score ?? 0, 0.5, 1e-9, 'ledger expected score');
});

test('loss subtracts symmetrically and stays ledger-consistent', () => {
  const before = getProfile(P1, G1)!.elo;
  const expected = computeElo(before, 1200, 'loss');
  const result = applyEloResult({ playerId: P1, gameId: G1, opponentRating: 1200, result: 'loss', idempotencyKey: 'elo:loss1' });
  assertTrue(result.delta < 0, 'loss delta negative');
  assertEqual(result.profile.elo, expected.newRating, 'matches engine');
  const row = ledger('elo:loss1');
  assertEqual(row!.rating_before + row!.delta, row!.rating_after, 'ledger arithmetic');
});

test('draw yields a zero delta transaction', () => {
  getOrCreateProfile(P2, G1);
  const result = applyEloResult({ playerId: P2, gameId: G1, opponentRating: 1200, result: 'draw', idempotencyKey: 'elo:draw1' });
  assertEqual(result.delta, 0, 'draw delta 0');
  assertEqual(result.profile.elo, 1200, 'elo unchanged');
  const row = ledger('elo:draw1');
  assertTrue(!!row, 'ledger row exists');
  assertEqual(row!.delta, 0, 'ledger delta 0');
  assertEqual(row!.rating_before, row!.rating_after, 'balances equal');
});

test('K-factor is configurable per match', () => {
  getOrCreateProfile(P3, G1);
  const result = applyEloResult({ playerId: P3, gameId: G1, opponentRating: 1200, result: 'win', kFactor: 16, idempotencyKey: 'elo:k16' });
  assertEqual(result.delta, 8, 'K=16 delta');
  assertEqual(ledger('elo:k16')!.k_factor, 16, 'ledger k factor');
});

test('duplicate idempotency key never applies Elo twice', () => {
  getOrCreateProfile(P7, G1);
  const first = applyEloResult({ playerId: P7, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'elo:dup' });
  const afterFirst = first.profile.elo;
  const countBefore = countRows('elo_transactions');
  const second = applyEloResult({ playerId: P7, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'elo:dup' });
  assertTrue(!second.applied && second.alreadyProcessed, 'duplicate detected');
  assertEqual(second.profile.elo, afterFirst, 'elo unchanged');
  assertEqual(countRows('elo_transactions'), countBefore, 'no new ledger row');
});

test('cross-game isolation: updating one game leaves the other at default', () => {
  getOrCreateProfile(P5, G2);
  applyEloResult({ playerId: P5, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'elo:g1' });
  assertEqual(getProfile(P5, G1)!.elo, 1216, 'dueling updated');
  assertEqual(getProfile(P5, G2)!.elo, 1200, 'rocket untouched');
});

test('admin Elo adjustments are ledger-based with NULL match fields', () => {
  getOrCreateProfile(P4, G1);
  const add = applyAdminEloAdjustment({ playerId: P4, gameId: G1, amount: 50, idempotencyKey: 'elo:admin:add', sourceId: 'admin-1' });
  assertEqual(add.profile.elo, 1250, 'positive adjustment');
  const addRow = ledger('elo:admin:add');
  assertEqual(addRow!.source_type, 'admin', 'source type admin');
  assertNull(addRow!.k_factor, 'k factor null for admin');
  assertNull(addRow!.opponent_rating_avg, 'opponent null for admin');
  assertNull(addRow!.expected_score, 'expected null for admin');

  const sub = applyAdminEloAdjustment({ playerId: P4, gameId: G1, amount: -100, idempotencyKey: 'elo:admin:sub' });
  assertEqual(sub.profile.elo, 1150, 'negative adjustment');
  assertEqual(sub.delta, -100, 'delta preserved');
});

test('invalid inputs are rejected', () => {
  assertThrows(
    () => applyEloResult({ playerId: P1, gameId: G1, opponentRating: 1200, result: 'lose' as unknown as CompetitiveResult, idempotencyKey: 'elo:bad' }),
    'invalid result'
  );
  assertThrows(
    () => applyEloResult({ playerId: P1, gameId: G1, opponentRating: Number.NaN, result: 'win', idempotencyKey: 'elo:bad2' }),
    'non-finite opponent'
  );
  assertThrows(
    () => applyEloResult({ playerId: P1, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: '' }),
    'empty key'
  );
  assertThrows(
    () => applyEloResult({ playerId: 'missing-player', gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'elo:bad3' }),
    'unknown player'
  );
  assertThrows(
    () => applyAdminEloAdjustment({ playerId: P1, gameId: G1, amount: Number.NaN, idempotencyKey: 'elo:bad4' }),
    'NaN admin amount'
  );
});

test('ledger + profile update are atomic (rollback on failure)', () => {
  const beforeElo = getProfile(P6, G1)?.elo ?? 1200;
  const beforeCount = countRows('elo_transactions');
  getDb().exec(
    "CREATE TRIGGER test_abort_elo_profile BEFORE UPDATE ON competitive_profiles BEGIN SELECT RAISE(ABORT, 'test-abort'); END;"
  );
  try {
    assertThrows(
      () => applyEloResult({ playerId: P6, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'elo:rollback' }),
      'profile update failure rolls back'
    );
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS test_abort_elo_profile');
  }
  assertEqual(getProfile(P6, G1)?.elo ?? beforeElo, beforeElo, 'profile unchanged');
  assertEqual(countRows('elo_transactions'), beforeCount, 'no ledger row persisted');
  assertEqual(ledger('elo:rollback'), undefined, 'rolled-back transaction absent');
});

cleanupTestDb();
summarize('EloService');
