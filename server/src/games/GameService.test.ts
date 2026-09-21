/**
 * R2 — GameService edit-save duplicate-name fix.
 *
 * Verifies that saving an existing game with its current Arabic name succeeds
 * even when a legacy duplicate row shares that name, that renaming to another
 * game's name is still rejected, and that createGame now enforces Arabic-name
 * uniqueness. Also proves a tournament update performs NO write to `games`.
 *
 * Run: `ts-node src/games/GameService.test.ts` (wired into `npm run test`).
 */

import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import { seedTournament, seedUser } from '../competitive/competitiveTestSeed';
import { createGame, getAllGames, getGameById, updateGame } from './GameService';
import { getTournamentById, updateTournament } from './TournamentService';
import { assertEqual, assertThrows, assertTrue, summarize, test } from '../competitive/testHarness';

const ADMIN = 'r2-game-admin';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');
seedUser(ADMIN);

function wipe(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
    db.prepare('DELETE FROM games').run();
  })();
}

/** Inserts a games row directly, bypassing createGame's validation. */
function insertGameRaw(id: string, slug: string, nameAr: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO games (id, slug, name_ar, description_ar, image_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 1, 0, ?, ?)`
    )
    .run(id, slug, nameAr, now, now);
}

function snapshotGames(): string {
  return JSON.stringify(getAllGames());
}

console.log('=== GameService (R2) ===');

test('A — updateGame with an UNCHANGED name_ar succeeds despite a legacy duplicate', () => {
  wipe();
  insertGameRaw('dup-1', 'dup_1', 'روكت ليق');
  insertGameRaw('dup-2', 'dup_2', 'روكت ليق');

  const updated = updateGame('dup-1', { name_ar: 'روكت ليق', image_url: '/assets/x.webp' });

  assertEqual(updated.name_ar, 'روكت ليق', 'name unchanged');
  assertEqual(updated.image_url, '/assets/x.webp', 'image updated');
  assertEqual(getGameById('dup-2')!.image_url, null, 'the other duplicate row is untouched');
});

test('B — updateGame renaming to another existing name is rejected', () => {
  wipe();
  const a = createGame({ name_ar: 'Alpha Game' });
  createGame({ name_ar: 'Beta Game' });

  assertThrows(() => updateGame(a.id, { name_ar: 'Beta Game' }), 'rename to an existing name rejected');
  assertEqual(getGameById(a.id)!.name_ar, 'Alpha Game', 'rejected rename left the row unchanged');
});

test('C — updateGame renaming to a unique name succeeds', () => {
  wipe();
  const a = createGame({ name_ar: 'Alpha Game' });
  const updated = updateGame(a.id, { name_ar: 'Gamma Game' });
  assertEqual(updated.name_ar, 'Gamma Game', 'rename applied');
});

test('D — createGame with a duplicate name_ar is rejected', () => {
  wipe();
  createGame({ name_ar: 'Unique Name' });
  assertThrows(() => createGame({ name_ar: 'Unique Name' }), 'duplicate name rejected');
  assertEqual(getAllGames().length, 1, 'no duplicate row inserted');
});

test('E — createGame with a unique name_ar succeeds', () => {
  wipe();
  const g = createGame({ name_ar: 'Fresh Name' });
  assertEqual(g.name_ar, 'Fresh Name', 'created');
  assertTrue(getGameById(g.id) !== null, 'row exists');
});

test('F — tournament update performs NO write to the games table', () => {
  wipe();
  const game = createGame({ name_ar: 'Tournament Game' });
  seedTournament({ id: 'r2-t', gameId: game.id, nameAr: 'Tournament A', status: 'open', createdBy: ADMIN });

  const before = snapshotGames();
  updateTournament('r2-t', { name_ar: 'Tournament B', description_ar: 'updated' });
  const after = snapshotGames();

  assertEqual(getTournamentById('r2-t')!.name_ar, 'Tournament B', 'tournament updated');
  assertEqual(after, before, 'games table unchanged by tournament update');
});

cleanupTestDb();
summarize('GameService (R2)');
