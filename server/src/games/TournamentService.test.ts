/**
 * R2 — TournamentService name normalization (whitespace) tests.
 *
 * Verifies that editing a tournament whose stored name carries legacy
 * leading/trailing whitespace succeeds when the trimmed equivalent is
 * submitted, that an unchanged name is accepted, that renaming to another
 * tournament's logical name is still rejected, and that creating a duplicate
 * logical tournament name is rejected.
 *
 * Isolated temp DB only (via ../competitive/testDb). Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import { cleanTournaments, seedGame, seedUser } from '../competitive/competitiveTestSeed';
import { createTournament, getTournamentById, updateTournament } from './TournamentService';
import { assertEqual, assertThrows, summarize, test } from '../competitive/testHarness';

const GAME = 'r2-tour-game';
const ADMIN = 'r2-tour-admin';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');
seedGame(GAME, 'r2-tour-game', 'R2 Tour Game');
seedUser(ADMIN, 'admin');

/** Inserts a tournaments row directly (bypasses createTournament's validation). */
function rawTournament(id: string, nameAr: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO tournaments
         (id, game_id, name_ar, status, created_by, created_at, updated_at, participant_count)
       VALUES (?, ?, ?, 'open', ?, ?, ?, 0)`
    )
    .run(id, GAME, nameAr, ADMIN, now, now);
}

function tournamentCount(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM tournaments').get() as { n: number }).n;
}

console.log('=== TournamentService (R2) ===');

test('H — editing a legacy whitespace-padded name with the trimmed name succeeds', () => {
  cleanTournaments();
  rawTournament('t-ws-trimmed', 'الموسم الأول');
  rawTournament('t-ws-padded', 'الموسم الأول '); // legacy trailing space

  const updated = updateTournament('t-ws-padded', { name_ar: 'الموسم الأول', description_ar: 'x' });

  assertEqual(updated.name_ar, 'الموسم الأول', 'submitted trimmed name written');
  assertEqual(getTournamentById('t-ws-trimmed')!.name_ar, 'الموسم الأول', 'other row untouched');
});

test('I — editing an unchanged tournament name succeeds', () => {
  cleanTournaments();
  const t = createTournament({ game_id: GAME, name_ar: 'Unchanged Cup' }, ADMIN);
  const updated = updateTournament(t.id, { name_ar: 'Unchanged Cup', description_ar: 'y' });
  assertEqual(updated.name_ar, 'Unchanged Cup', 'name unchanged');
  assertEqual(updated.description_ar, 'y', 'other field updated');
});

test('J — renaming to another existing logical tournament name is rejected', () => {
  cleanTournaments();
  const a = createTournament({ game_id: GAME, name_ar: 'Alpha Cup' }, ADMIN);
  createTournament({ game_id: GAME, name_ar: 'Beta Cup' }, ADMIN);

  assertThrows(() => updateTournament(a.id, { name_ar: 'Beta Cup' }), 'exact duplicate rename rejected');
  assertThrows(() => updateTournament(a.id, { name_ar: '  Beta Cup  ' }), 'whitespace-padded rename rejected');
  assertEqual(getTournamentById(a.id)!.name_ar, 'Alpha Cup', 'rejected rename left the row unchanged');
});

test('K — renaming to a unique tournament name succeeds', () => {
  cleanTournaments();
  const a = createTournament({ game_id: GAME, name_ar: 'Alpha Cup' }, ADMIN);
  const updated = updateTournament(a.id, { name_ar: 'Gamma Cup' });
  assertEqual(updated.name_ar, 'Gamma Cup', 'rename applied');
});

test('L — creating a duplicate logical tournament name is rejected', () => {
  cleanTournaments();
  createTournament({ game_id: GAME, name_ar: 'Unique Cup' }, ADMIN);

  assertThrows(() => createTournament({ game_id: GAME, name_ar: 'Unique Cup' }, ADMIN), 'exact duplicate rejected');
  assertThrows(
    () => createTournament({ game_id: GAME, name_ar: '  Unique Cup  ' }, ADMIN),
    'whitespace-padded duplicate rejected'
  );
  assertEqual(tournamentCount(), 1, 'no duplicate row inserted');
});

cleanupTestDb();
summarize('TournamentService (R2)');
