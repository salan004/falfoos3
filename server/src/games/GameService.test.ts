/**
 * R2 — GameService edit-save duplicate-name fix (with whitespace normalization).
 *
 * Verifies that saving an existing game with its current Arabic name succeeds
 * even when a legacy duplicate row shares that name, that a legacy stored name
 * with leading/trailing whitespace is not treated as a rename when the trimmed
 * equivalent is submitted, that renaming to another game's logical name is
 * still rejected, and that createGame enforces normalized uniqueness. Also
 * proves a tournament update performs NO write to `games`.
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

test('A — editing a legacy whitespace-padded name with the trimmed name succeeds (image-only change)', () => {
  wipe();
  insertGameRaw('ws-trimmed', 'ws_trimmed', 'روكت ليق');
  insertGameRaw('ws-padded', 'ws_padded', 'روكت ليق '); // legacy trailing space

  const updated = updateGame('ws-padded', { name_ar: 'روكت ليق', image_url: '/assets/x.webp' });

  assertEqual(updated.name_ar, 'روكت ليق', 'submitted trimmed name written');
  assertEqual(updated.image_url, '/assets/x.webp', 'image updated');
  assertEqual(getGameById('ws-trimmed')!.name_ar, 'روكت ليق', 'the other row is untouched');
  assertEqual(getGameById('ws-trimmed')!.image_url, null, 'the other row image untouched');
});

test('B — editing an unchanged exact name succeeds', () => {
  wipe();
  insertGameRaw('b-1', 'b_1', 'روكت ليق');
  const updated = updateGame('b-1', { name_ar: 'روكت ليق', description_ar: 'desc' });
  assertEqual(updated.name_ar, 'روكت ليق', 'name unchanged');
  assertEqual(updated.description_ar, 'desc', 'other field updated');
});

test('C — renaming to another existing logical name is rejected', () => {
  wipe();
  const a = createGame({ name_ar: 'Alpha Game' });
  createGame({ name_ar: 'Beta Game' });

  assertThrows(() => updateGame(a.id, { name_ar: 'Beta Game' }), 'exact duplicate rename rejected');
  assertThrows(() => updateGame(a.id, { name_ar: '  Beta Game  ' }), 'whitespace-padded duplicate rename rejected');
  assertEqual(getGameById(a.id)!.name_ar, 'Alpha Game', 'rejected rename left the row unchanged');
});

test('D — renaming to a genuinely unique name succeeds', () => {
  wipe();
  const a = createGame({ name_ar: 'Alpha Game' });
  const updated = updateGame(a.id, { name_ar: 'Gamma Game' });
  assertEqual(updated.name_ar, 'Gamma Game', 'rename applied');
});

test('E — creating a duplicate logical name is rejected', () => {
  wipe();
  createGame({ name_ar: 'Unique Name' });
  assertThrows(() => createGame({ name_ar: 'Unique Name' }), 'exact duplicate rejected');
  assertThrows(() => createGame({ name_ar: '  Unique Name  ' }), 'whitespace-padded duplicate rejected');
  assertEqual(getAllGames().length, 1, 'no duplicate row inserted');
});

test('F — creating a unique name succeeds', () => {
  wipe();
  const g = createGame({ name_ar: 'Fresh Name' });
  assertEqual(g.name_ar, 'Fresh Name', 'created');
  assertTrue(getGameById(g.id) !== null, 'row exists');
});

test('G — explicit regression: leading/trailing whitespace is normalized for uniqueness', () => {
  wipe();
  insertGameRaw('g-legacy', 'g_legacy', '  Spaced Name  ');

  // A trimmed duplicate cannot be created while the padded legacy row exists.
  assertThrows(() => createGame({ name_ar: 'Spaced Name' }), 'create logical duplicate rejected');

  // Editing the legacy row with the trimmed name is NOT a rename and succeeds,
  // writing the trimmed value back.
  const updated = updateGame('g-legacy', { name_ar: 'Spaced Name', description_ar: 'x' });
  assertEqual(updated.name_ar, 'Spaced Name', 'trimmed name written on edit');
});

test('H — tournament update performs NO write to the games table', () => {
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
