/**
 * Phase 4B — competitive_profiles schema + service tests.
 * Run: `npm -w server run test`.
 */

// Must be first: points the DB singleton at an isolated temp database.
import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import { cleanCompetitive, countRows, seedGame, seedPlayer } from './competitiveTestSeed';
import {
  applyResultStats,
  gameExists,
  getOrCreateProfile,
  getProfile,
  getProfileWithRank,
  playerExists,
} from './CompetitiveProfileService';
import { DEFAULT_INITIAL_ELO } from './eloEngine';
import { computeRank } from './ranks';
import { assertEqual, assertNull, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const P1 = 'aaaaaaaa-1111-4111-8111-111111111111';
const P2 = 'bbbbbbbb-2222-4222-8222-222222222222';
const G1 = 'game-dueling';
const G2 = 'game-rocket';

console.log('=== CompetitiveProfileService ===');

test('competitive_profiles has a (player_id, game_id) composite primary key', () => {
  const cols = getDb().prepare(`PRAGMA table_info('competitive_profiles')`).all() as {
    name: string;
    pk: number;
  }[];
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assertEqual(pk.join(','), 'player_id,game_id', 'composite PK columns');
});

test('competitive_profiles never stores rank state', () => {
  const names = (getDb().prepare(`PRAGMA table_info('competitive_profiles')`).all() as {
    name: string;
  }[]).map((c) => c.name);
  for (const forbidden of ['rank', 'rank_key', 'rank_name', 'division', 'level', 'level_index']) {
    assertTrue(!names.includes(forbidden), `no "${forbidden}" column`);
  }
  assertTrue(names.includes('lp') && names.includes('elo'), 'lp and elo columns present');
});

test('defaults are lp=0, elo=1200, stats=0', () => {
  seedPlayer(P1);
  seedGame(G1, 'dueling_grounds');
  assertEqual(getProfile(P1, G1), null, 'no profile before creation');
  const profile = getOrCreateProfile(P1, G1);
  assertEqual(profile.lp, 0, 'default lp');
  assertEqual(profile.elo, DEFAULT_INITIAL_ELO, 'default elo');
  assertEqual(profile.elo, 1200, 'elo literal default');
  assertEqual(profile.matches_played, 0, 'default matches_played');
  assertEqual(profile.wins, 0, 'default wins');
  assertEqual(profile.losses, 0, 'default losses');
  assertEqual(profile.draws, 0, 'default draws');
  assertNull(profile.last_played_at, 'default last_played_at');
  assertTrue(profile.created_at > 0 && profile.updated_at > 0, 'timestamps set');
});

test('get-or-create is idempotent for the same player+game', () => {
  const first = getOrCreateProfile(P1, G1);
  const second = getOrCreateProfile(P1, G1);
  assertEqual(second.created_at, first.created_at, 'same row returned');
  assertEqual(second.player_id, first.player_id, 'same player');
  assertEqual(second.game_id, first.game_id, 'same game');
});

test('the same player has independent profiles per game', () => {
  seedGame(G2, 'rocket_league');
  const dueling = getOrCreateProfile(P1, G1);
  const rocket = getOrCreateProfile(P1, G2);
  assertEqual(dueling.game_id, G1, 'dueling profile game');
  assertEqual(rocket.game_id, G2, 'rocket profile game');
  assertTrue(dueling.created_at !== undefined && rocket.created_at !== undefined, 'both created');
});

test('foreign keys are enforced (unknown player / unknown game)', () => {
  assertTrue(!playerExists('missing-player'), 'unknown player not found');
  assertTrue(!gameExists('missing-game'), 'unknown game not found');
  assertThrows(() => getOrCreateProfile('missing-player', G1), 'unknown player rejected');
  assertThrows(() => getOrCreateProfile(P1, 'missing-game'), 'unknown game rejected');
});

test('lp CHECK constraint rejects negative LP in the schema', () => {
  const now = Date.now();
  assertThrows(
    () =>
      getDb()
        .prepare(
          `INSERT INTO competitive_profiles (player_id, game_id, lp, elo, matches_played, wins, losses, draws, last_played_at, created_at, updated_at)
           VALUES (?, ?, -1, 1200, 0, 0, 0, 0, NULL, ?, ?)`
        )
        .run(P1, G1, now, now),
    'negative lp rejected'
  );
});

test('stats CHECK constraint rejects wins+losses+draws > matches_played', () => {
  seedPlayer(P2);
  const now = Date.now();
  assertThrows(
    () =>
      getDb()
        .prepare(
          `INSERT INTO competitive_profiles (player_id, game_id, lp, elo, matches_played, wins, losses, draws, last_played_at, created_at, updated_at)
           VALUES (?, ?, 0, 1200, 0, 1, 0, 0, NULL, ?, ?)`
        )
        .run(P2, G1, now, now),
    'inconsistent stats rejected'
  );
});

test('applyResultStats increments the correct counters atomically', () => {
  seedPlayer(P2);
  getOrCreateProfile(P2, G1);
  let profile = applyResultStats(P2, G1, 'win');
  assertEqual(profile.matches_played, 1, 'matches after win');
  assertEqual(profile.wins, 1, 'wins after win');
  profile = applyResultStats(P2, G1, 'loss');
  assertEqual(profile.matches_played, 2, 'matches after loss');
  assertEqual(profile.losses, 1, 'losses after loss');
  profile = applyResultStats(P2, G1, 'draw');
  assertEqual(profile.matches_played, 3, 'matches after draw');
  assertEqual(profile.draws, 1, 'draws after draw');
  assertEqual(profile.wins + profile.losses + profile.draws, 3, 'counters sum to matches');
  assertTrue(profile.last_played_at !== null, 'last_played_at set');
});

test('derived rank tracks LP and is never stored', () => {
  const db = getDb();
  db.prepare('UPDATE competitive_profiles SET lp = ? WHERE player_id = ? AND game_id = ?').run(
    1050,
    P1,
    G1
  );
  const withRank = getProfileWithRank(P1, G1);
  assertTrue(withRank !== null, 'profile found');
  assertEqual(withRank!.lp, 1050, 'lp read');
  assertEqual(withRank!.rank.rankKey, computeRank(1050).rankKey, 'rank derived from lp');
  assertEqual(withRank!.rank.rankKey, 'platinum_2', 'platinum_2 at 1050');
});

test('schema exposes useful lookup indexes', () => {
  const names = (getDb().prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
    name: string;
  }[]).map((r) => r.name);
  for (const idx of [
    'idx_competitive_profiles_game_lp',
    'idx_competitive_profiles_game_elo',
  ]) {
    assertTrue(names.includes(idx), `index ${idx} exists`);
  }
});

test('cleanCompetitive resets only competitive tables', () => {
  cleanCompetitive();
  assertEqual(countRows('competitive_profiles'), 0, 'profiles cleared');
  assertEqual(countRows('lp_transactions'), 0, 'lp cleared');
  assertEqual(countRows('elo_transactions'), 0, 'elo cleared');
  assertTrue(playerExists(P1) && gameExists(G1), 'guests/games untouched');
});

cleanupTestDb();
summarize('CompetitiveProfileService');
