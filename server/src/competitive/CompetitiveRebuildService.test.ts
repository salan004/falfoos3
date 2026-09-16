/**
 * Phase 4B — CompetitiveRebuildService tests: deterministic reconstruction of
 * materialized profiles from the immutable ledgers, without mutating history.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import { cleanCompetitive, seedGame, seedPlayer } from './competitiveTestSeed';
import {
  deriveProfileState,
  rebuildAllProfiles,
  rebuildProfile,
  snapshotProfile,
} from './CompetitiveRebuildService';
import { applyLpResult } from './LpService';
import { applyEloResult } from './EloService';
import { applyResultStats, getOrCreateProfile, getProfile } from './CompetitiveProfileService';
import { assertEqual, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const G1 = 'game-dueling';

seedPlayer(P1);
seedPlayer(P2);
seedGame(G1, 'dueling_grounds');
cleanCompetitive();

function ledgerDump(): string {
  const lp = getDb().prepare('SELECT * FROM lp_transactions ORDER BY id ASC').all();
  const elo = getDb().prepare('SELECT * FROM elo_transactions ORDER BY id ASC').all();
  return JSON.stringify({ lp, elo });
}

console.log('=== CompetitiveRebuildService ===');

test('rebuild of an empty profile yields the configured defaults', () => {
  getOrCreateProfile(P1, G1);
  const result = rebuildProfile(P1, G1);
  assertEqual(result.after.lp, 0, 'lp');
  assertEqual(result.after.elo, 1200, 'elo');
  assertEqual(result.after.matches_played, 0, 'matches');
  assertTrue(!result.changed, 'nothing to change from defaults');
});

test('rebuild reconstructs LP, Elo and stats from the ledgers', () => {
  // A consistent sequence: win, loss, draw — stats and ratings applied together.
  applyResultStats(P1, G1, 'win');
  applyLpResult({ playerId: P1, gameId: G1, result: 'win', idempotencyKey: 'rebuild:lp:1' });
  applyEloResult({ playerId: P1, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'rebuild:elo:1' });

  applyResultStats(P1, G1, 'loss');
  applyLpResult({ playerId: P1, gameId: G1, result: 'loss', idempotencyKey: 'rebuild:lp:2' });
  applyEloResult({ playerId: P1, gameId: G1, opponentRating: 1200, result: 'loss', idempotencyKey: 'rebuild:elo:2' });

  applyResultStats(P1, G1, 'draw');
  applyLpResult({ playerId: P1, gameId: G1, result: 'draw', idempotencyKey: 'rebuild:lp:3' });

  const expected = snapshotProfile(P1, G1);
  assertTrue(expected !== null, 'expected snapshot');
  assertEqual(expected!.lp, 5, 'expected lp 25-20+0');
  assertEqual(expected!.matches_played, 3, 'expected matches');
  assertEqual(expected!.wins, 1, 'expected wins');
  assertEqual(expected!.losses, 1, 'expected losses');
  assertEqual(expected!.draws, 1, 'expected draws');

  const ledgersBefore = ledgerDump();

  // Deliberately corrupt the materialized row (values must satisfy the stats
  // CHECK, otherwise the corruption itself would be rejected).
  getDb()
    .prepare(
      `UPDATE competitive_profiles
          SET lp = 9999, elo = 9999, matches_played = 50, wins = 10, losses = 10, draws = 5
        WHERE player_id = ? AND game_id = ?`
    )
    .run(P1, G1);

  const result = rebuildProfile(P1, G1);
  assertTrue(result.changed, 'rebuild reports a change');
  assertEqual(result.before.lp, 9999, 'before reflects corruption');
  assertEqual(JSON.stringify(result.after), JSON.stringify(expected), 'after equals ledger-derived state');
  assertEqual(JSON.stringify(deriveProfileState(P1, G1)), JSON.stringify(expected), 'derive matches');

  // History is immutable: rebuilding never touches ledger rows.
  assertEqual(ledgerDump(), ledgersBefore, 'ledgers unchanged by rebuild');
});

test('a second rebuild is a no-op (idempotent)', () => {
  const before = snapshotProfile(P1, G1);
  const result = rebuildProfile(P1, G1);
  assertTrue(!result.changed, 'no change on already-consistent profile');
  assertEqual(JSON.stringify(result.after), JSON.stringify(before), 'values stable');
});

test('rebuild recreates a materialized profile deleted while ledgers remain', () => {
  applyLpResult({ playerId: P2, gameId: G1, result: 'win', idempotencyKey: 'rebuild:p2:lp' });
  applyEloResult({ playerId: P2, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'rebuild:p2:elo' });
  getDb().prepare('DELETE FROM competitive_profiles WHERE player_id = ? AND game_id = ?').run(P2, G1);
  assertEqual(getProfile(P2, G1), null, 'profile deleted');

  const result = rebuildProfile(P2, G1);
  assertEqual(result.after.lp, 25, 'lp reconstructed');
  assertEqual(result.after.elo, 1216, 'elo reconstructed');
  assertEqual(getProfile(P2, G1)!.lp, 25, 'profile row re-materialized');
});

test('rebuildAllProfiles covers every referenced (player, game) pair', () => {
  const results = rebuildAllProfiles();
  const key = (r: { playerId: string; gameId: string }) => `${r.playerId}::${r.gameId}`;
  const keys = results.map(key);
  assertTrue(keys.includes(key({ playerId: P1, gameId: G1 })), 'includes P1/G1');
  assertTrue(keys.includes(key({ playerId: P2, gameId: G1 })), 'includes P2/G1');
});

cleanupTestDb();
summarize('CompetitiveRebuildService');
