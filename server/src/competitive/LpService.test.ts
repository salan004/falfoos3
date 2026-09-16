/**
 * Phase 4B — LpService tests: deltas, floor, ledger, idempotency, atomicity,
 * cross-game isolation, admin adjustments.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import { cleanCompetitive, countRows, seedGame, seedPlayer } from './competitiveTestSeed';
import { applyAdminLpAdjustment, applyLpDelta, applyLpResult } from './LpService';
import { getOrCreateProfile, getProfile } from './CompetitiveProfileService';
import type { CompetitiveResult, CompetitiveSourceType } from './types';
import { assertEqual, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const P4 = '44444444-4444-4444-8444-444444444444';
const G1 = 'game-dueling';
const G2 = 'game-rocket';

seedPlayer(P1);
seedPlayer(P2);
seedPlayer(P3);
seedPlayer(P4);
seedGame(G1, 'dueling_grounds');
seedGame(G2, 'rocket_league');
cleanCompetitive();

interface LpRow {
  id: number;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  source_type: string;
  source_id: string | null;
  match_id: string | null;
  idempotency_key: string;
}

function ledger(key: string): LpRow | undefined {
  return getDb().prepare('SELECT * FROM lp_transactions WHERE idempotency_key = ?').get(key) as
    | LpRow
    | undefined;
}

console.log('=== LpService ===');

test('win awards +25 and writes an immutable ledger row', () => {
  const result = applyLpResult({
    playerId: P1,
    gameId: G1,
    result: 'win',
    idempotencyKey: 'lp:win1',
    matchId: 'match-1',
    sourceId: 'match-1',
  });
  assertTrue(result.applied, 'applied');
  assertEqual(result.amount, 25, 'effective amount');
  assertEqual(result.profile.lp, 25, 'profile lp');
  assertEqual(result.balanceBefore, 0, 'balance before');
  assertEqual(result.balanceAfter, 25, 'balance after');

  const row = ledger('lp:win1');
  assertTrue(!!row, 'ledger row exists');
  assertEqual(row!.amount, 25, 'ledger amount');
  assertEqual(row!.balance_before, 0, 'ledger before');
  assertEqual(row!.balance_after, 25, 'ledger after');
  assertEqual(row!.reason, 'match_win', 'ledger reason');
  assertEqual(row!.source_type, 'match', 'ledger source type');
  assertEqual(row!.match_id, 'match-1', 'ledger match id');
});

test('loss subtracts -20', () => {
  const result = applyLpResult({ playerId: P1, gameId: G1, result: 'loss', idempotencyKey: 'lp:loss1' });
  assertEqual(result.amount, -20, 'effective amount');
  assertEqual(result.profile.lp, 5, 'profile lp');
  assertEqual(ledger('lp:loss1')!.balance_after, 5, 'ledger after');
});

test('draw produces an auditable 0-value transaction with equal balances', () => {
  const before = getProfile(P1, G1)!.lp;
  const result = applyLpResult({ playerId: P1, gameId: G1, result: 'draw', idempotencyKey: 'lp:draw1' });
  assertTrue(result.applied, 'applied');
  assertEqual(result.amount, 0, 'effective amount 0');
  assertEqual(result.profile.lp, before, 'profile lp unchanged');
  const row = ledger('lp:draw1');
  assertTrue(!!row, 'ledger row exists for draw');
  assertEqual(row!.amount, 0, 'ledger amount 0');
  assertEqual(row!.balance_before, row!.balance_after, 'balances equal');
  assertEqual(row!.reason, 'match_draw', 'ledger reason');
});

test('LP floors at zero and records the effective (clamped) amount', () => {
  applyAdminLpAdjustment({ playerId: P2, gameId: G1, amount: 10, idempotencyKey: 'lp:p2:seed' });
  const result = applyLpResult({ playerId: P2, gameId: G1, result: 'loss', idempotencyKey: 'lp:p2:loss' });
  assertEqual(result.profile.lp, 0, 'floored at zero');
  assertEqual(result.balanceBefore, 10, 'balance before');
  assertEqual(result.balanceAfter, 0, 'balance after');
  assertEqual(result.amount, -10, 'effective amount is clamped');
  const row = ledger('lp:p2:loss');
  assertEqual(row!.amount, -10, 'ledger effective amount');
  assertEqual(row!.balance_before + row!.amount, row!.balance_after, 'ledger arithmetic consistent');
});

test('duplicate idempotency key never applies LP twice', () => {
  const countBefore = countRows('lp_transactions');
  const first = applyLpResult({ playerId: P3, gameId: G1, result: 'win', idempotencyKey: 'lp:dup' });
  const lpAfterFirst = first.profile.lp;
  const second = applyLpResult({ playerId: P3, gameId: G1, result: 'win', idempotencyKey: 'lp:dup' });
  assertTrue(!second.applied, 'second call not applied');
  assertTrue(second.alreadyProcessed, 'second call flagged as processed');
  assertEqual(second.profile.lp, lpAfterFirst, 'profile unchanged on duplicate');
  assertEqual(countRows('lp_transactions'), countBefore + 1, 'exactly one ledger row');
  assertEqual(second.balanceAfter, lpAfterFirst, 'duplicate reports existing balance');
});

test('different idempotency keys apply independently', () => {
  const before = getProfile(P3, G1)!.lp;
  const result = applyLpResult({ playerId: P3, gameId: G1, result: 'win', idempotencyKey: 'lp:dup:other' });
  assertTrue(result.applied, 'applied');
  assertEqual(result.profile.lp, before + 25, 'second win applied');
});

test('cross-game isolation: one game never changes another', () => {
  const duelingBefore = getProfile(P3, G1)!.lp;
  const rocket = getOrCreateProfile(P3, G2);
  assertEqual(rocket.lp, 0, 'rocket profile starts at 0 LP');
  applyLpResult({ playerId: P3, gameId: G2, result: 'win', idempotencyKey: 'lp:g2:win' });
  assertEqual(getProfile(P3, G2)!.lp, 25, 'rocket updated');
  assertEqual(getProfile(P3, G1)!.lp, duelingBefore, 'dueling untouched by rocket change');
});

test('admin adjustments are ledger-based and support both directions', () => {
  const add = applyAdminLpAdjustment({
    playerId: P4,
    gameId: G1,
    amount: 40,
    idempotencyKey: 'lp:admin:add',
    sourceId: 'admin-user-1',
  });
  assertEqual(add.profile.lp, 40, 'positive adjustment');
  assertEqual(ledger('lp:admin:add')!.source_type, 'admin', 'source type admin');
  assertEqual(ledger('lp:admin:add')!.reason, 'admin_adjustment', 'admin reason');

  const sub = applyAdminLpAdjustment({ playerId: P4, gameId: G1, amount: -10, idempotencyKey: 'lp:admin:sub' });
  assertEqual(sub.profile.lp, 30, 'negative adjustment');

  const overdraw = applyAdminLpAdjustment({ playerId: P4, gameId: G1, amount: -100, idempotencyKey: 'lp:admin:overdraw' });
  assertEqual(overdraw.profile.lp, 0, 'admin overdraw floors at zero');
  assertEqual(overdraw.amount, -30, 'effective clamped amount');
  assertEqual(ledger('lp:admin:overdraw')!.balance_after, 0, 'ledger floor');
});

test('invalid inputs are rejected', () => {
  assertThrows(
    () => applyLpResult({ playerId: P1, gameId: G1, result: 'lose' as unknown as CompetitiveResult, idempotencyKey: 'lp:bad' }),
    'invalid result'
  );
  assertThrows(
    () => applyLpDelta({ playerId: P1, gameId: G1, delta: 5, reason: 'x', sourceType: 'bogus' as unknown as CompetitiveSourceType, idempotencyKey: 'lp:bad2' }),
    'invalid source type'
  );
  assertThrows(
    () => applyLpResult({ playerId: P1, gameId: G1, result: 'win', idempotencyKey: '' }),
    'empty idempotency key'
  );
  assertThrows(
    () => applyAdminLpAdjustment({ playerId: P1, gameId: G1, amount: Number.NaN, idempotencyKey: 'lp:bad3' }),
    'NaN admin amount'
  );
  assertThrows(() => applyLpDelta({
    playerId: 'missing-player', gameId: G1, delta: 5, reason: 'x', sourceType: 'system', idempotencyKey: 'lp:bad4',
  }), 'unknown player');
});

test('ledger + profile update are atomic (rollback on failure)', () => {
  const beforeLp = getProfile(P3, G1)!.lp;
  const beforeCount = countRows('lp_transactions');
  getDb().exec(
    "CREATE TRIGGER test_abort_lp_profile BEFORE UPDATE ON competitive_profiles BEGIN SELECT RAISE(ABORT, 'test-abort'); END;"
  );
  try {
    assertThrows(
      () => applyLpResult({ playerId: P3, gameId: G1, result: 'win', idempotencyKey: 'lp:rollback' }),
      'profile update failure rolls back'
    );
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS test_abort_lp_profile');
  }
  assertEqual(getProfile(P3, G1)!.lp, beforeLp, 'profile unchanged after rollback');
  assertEqual(countRows('lp_transactions'), beforeCount, 'no ledger row persisted after rollback');
  assertEqual(ledger('lp:rollback'), undefined, 'rolled-back transaction absent');
});

cleanupTestDb();
summarize('LpService');
