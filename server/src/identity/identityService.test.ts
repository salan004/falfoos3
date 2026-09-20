/**
 * Phase 2.x — canonical identity resolution & reconciliation tests.
 *
 * Proves the bot/website identity split is healed: a YouTube channel always
 * resolves to ONE canonical player, legacy channel-keyed rows are backfilled in
 * place, real duplicates are merged losslessly, and a failed merge rolls back.
 *
 * Run: `ts-node src/identity/identityService.test.ts` (wired into `npm run test`).
 */

import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import {
  findCanonicalPlayerIdByChannel,
  findLinkedPlayerForUser,
  isYouTubeChannelId,
  mergePlayerIdentities,
  resolveOrCreatePlayerByYouTubeChannelId,
} from './identityService';
import { getProfile, applyResultStats } from '../competitive/CompetitiveProfileService';
import { applyLpResult } from '../competitive/LpService';
import { applyEloResult } from '../competitive/EloService';
import { claimGuestForUser } from '../auth/claiming';
import { seedGame, seedUser, seedTournament } from '../competitive/competitiveTestSeed';
import { assertEqual, assertTrue, assertNull, assertThrows, summarize, test } from '../competitive/testHarness';

const CHANNEL = 'UCIwIe7vdgk6jkOSm7Z1YKYQ'; // UC + 22 chars
const SURVIVOR = '11111111-1111-4111-8111-111111111111';
const G1 = 'id-game-dg';
const MATCH = 'id-match-1';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');
seedGame(G1, 'dueling_ground');
seedUser('admin', 'admin');

interface GuestOpts {
  channel?: string | null;
  name?: string;
  avatar?: string | null;
  claimed?: string | null;
}

function seedGuest(playerId: string, opts: GuestOpts = {}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO guests
         (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(playerId, opts.name ?? 'Player', opts.avatar ?? null, now, now, opts.claimed ?? null, opts.channel ?? null);
}

function getGuestRaw(playerId: string): { player_id: string; claimed_user_id: string | null; youtube_channel_id: string | null } | null {
  const row = getDb()
    .prepare('SELECT player_id, claimed_user_id, youtube_channel_id FROM guests WHERE player_id = ?')
    .get(playerId) as { player_id: string; claimed_user_id: string | null; youtube_channel_id: string | null } | undefined;
  return row ?? null;
}

function seedMatch(id: string, gameId = 'trivia'): void {
  getDb()
    .prepare('INSERT OR IGNORE INTO matches (id, game_id, started_at, ended_at, config_json) VALUES (?, ?, ?, NULL, NULL)')
    .run(id, gameId, Date.now());
}

function countAll(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function countWhere(table: string, playerId: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player_id = ?`).get(playerId) as { n: number }).n;
}

function guestsWithChannel(channelId: string): number {
  return (
    getDb().prepare('SELECT COUNT(*) AS n FROM guests WHERE youtube_channel_id = ?').get(channelId) as { n: number }
  ).n;
}

function wipeAll(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM match_result_corrections').run();
    db.prepare('DELETE FROM tournament_match_participants').run();
    db.prepare('DELETE FROM tournament_matches').run();
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
    db.prepare('DELETE FROM competitive_profiles').run();
    db.prepare('DELETE FROM lp_transactions').run();
    db.prepare('DELETE FROM elo_transactions').run();
    db.prepare('DELETE FROM match_winners').run();
    db.prepare('DELETE FROM score_events').run();
    db.prepare('DELETE FROM participations').run();
    db.prepare('DELETE FROM player_achievements').run();
    db.prepare('DELETE FROM matches').run();
    db.prepare('DELETE FROM guests').run();
  })();
}

function seedTournamentMatch(matchId: string, tournamentId: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO tournament_matches
         (id, tournament_id, game_id, round_no, slot_no, status, best_of, winner_player_id,
          next_match_id, next_match_slot, scheduled_at, started_at, completed_at, result_source,
          result_idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, 'active', 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
    )
    .run(matchId, tournamentId, G1, now, now);
}

console.log('=== IdentityService ===');

test('isYouTubeChannelId accepts channels and rejects UUIDs', () => {
  assertTrue(isYouTubeChannelId(CHANNEL), 'valid channel');
  assertEqual(isYouTubeChannelId(SURVIVOR), false, 'uuid rejected');
  assertEqual(isYouTubeChannelId(''), false, 'empty rejected');
});

test('1 — legacy channel-keyed identity is reused, not replaced (backfill)', () => {
  wipeAll();
  seedGuest(CHANNEL, { name: '@legacy' });
  assertEqual(findCanonicalPlayerIdByChannel(CHANNEL), CHANNEL, 'read lookup finds legacy');

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'Legacy');
  assertEqual(res.playerId, CHANNEL, 'same legacy player id');
  assertEqual(res.created, false, 'no new UUID created');
  assertEqual(res.merged, false, 'nothing to merge');
  assertEqual(getGuestRaw(CHANNEL)!.youtube_channel_id, CHANNEL, 'channel backfilled');
  assertEqual(guestsWithChannel(CHANNEL), 1, 'exactly one channel row');
  assertEqual(countAll('guests'), 1, 'no extra guest');
});

test('2 — dedicated channel identity always returns its existing UUID', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL, name: 'Falfoos' });
  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'Falfoos');
  assertEqual(res.playerId, SURVIVOR, 'canonical uuid');
  assertEqual(res.created, false, 'not created');
  assertEqual(res.merged, false, 'not merged');
  assertEqual(countAll('guests'), 1, 'no duplicate guest');
});

test('3 — existing duplicate identities are reconciled into one survivor', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL, name: 'Falfoos' });
  seedGuest(CHANNEL, { name: '@Falfoos' }); // legacy shape: youtube_channel_id NULL

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'Falfoos');
  assertEqual(res.playerId, SURVIVOR, 'dedicated survivor wins');
  assertEqual(res.merged, true, 'merge happened');
  assertEqual(res.mergedFrom, CHANNEL, 'legacy retired');
  assertNull(getGuestRaw(CHANNEL), 'legacy row removed');
  assertTrue(!!getGuestRaw(SURVIVOR), 'survivor intact');
  assertEqual(guestsWithChannel(CHANNEL), 1, 'one canonical identity remains');
});

test('4 — Stream Game history survives the merge on the canonical player', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});
  seedMatch(MATCH);
  const now = Date.now();
  getDb().prepare('INSERT INTO participations (match_id, player_id, status, joined_at) VALUES (?, ?, ?, ?)').run(MATCH, CHANNEL, 'joined', now);
  getDb().prepare('INSERT INTO score_events (match_id, player_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(MATCH, CHANNEL, 50, 'trivia:correct', now);
  getDb().prepare('INSERT INTO match_winners (match_id, player_id, scope, created_at) VALUES (?, ?, ?, ?)').run(MATCH, CHANNEL, 'round', now);
  getDb().prepare('INSERT INTO player_achievements (player_id, achievement_id, awarded_at) VALUES (?, ?, ?)').run(CHANNEL, 'first_match', now);

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'x');
  assertEqual(res.playerId, SURVIVOR, 'canonical');
  assertEqual(countWhere('participations', SURVIVOR), 1, 'participation moved');
  assertEqual(countWhere('score_events', SURVIVOR), 1, 'score moved');
  assertEqual(countWhere('match_winners', SURVIVOR), 1, 'winner moved');
  assertEqual(countWhere('player_achievements', SURVIVOR), 1, 'achievement moved');
  assertEqual(countWhere('participations', CHANNEL), 0, 'no legacy participation');
  assertEqual(countWhere('score_events', CHANNEL), 0, 'no legacy score');
});

test('5 — competitive tournament + LP/Elo history survives the merge', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});
  seedTournament({ id: 't5', gameId: G1, status: 'active', createdBy: 'admin' });
  getDb()
    .prepare('INSERT INTO tournament_participants (tournament_id, player_id, source, registered_at, ticket_ref, status) VALUES (?, ?, ?, ?, NULL, ?)')
    .run('t5', SURVIVOR, 'admin', Date.now(), 'registered');
  seedTournamentMatch('tm5', 't5');
  getDb()
    .prepare('INSERT INTO tournament_match_participants (match_id, player_id, slot, seed, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('tm5', SURVIVOR, 1, 1, Date.now());

  applyResultStats(SURVIVOR, G1, 'win');
  applyLpResult({ playerId: SURVIVOR, gameId: G1, result: 'win', idempotencyKey: 't5:s:lp', matchId: 'tm5' });
  applyEloResult({ playerId: SURVIVOR, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 't5:s:elo', matchId: 'tm5' });

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'x');
  assertEqual(res.playerId, SURVIVOR, 'canonical');
  assertEqual(countWhere('tournament_participants', CHANNEL), 0, 'legacy participant gone');
  assertEqual(countWhere('tournament_participants', SURVIVOR), 1, 'one participant');
  assertEqual(countWhere('tournament_match_participants', CHANNEL), 0, 'legacy match participant gone');
  assertEqual(countWhere('tournament_match_participants', SURVIVOR), 1, 'match reference preserved');
  assertEqual(countWhere('lp_transactions', SURVIVOR), 1, 'LP ledger preserved');
  assertEqual(countWhere('elo_transactions', SURVIVOR), 1, 'Elo ledger preserved');

  const profile = getProfile(SURVIVOR, G1)!;
  assertEqual(profile.lp, 25, 'LP unchanged');
  assertEqual(profile.elo, 1216, 'Elo unchanged');
  assertEqual(profile.wins, 1, 'win preserved');
  assertEqual(profile.matches_played, 1, 'matches preserved');
});

test('6 — same-game competitive conflict merges ledgers without fabricating results', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});

  // Survivor: one win. Legacy: another win. Both ledgers must survive and the
  // materialized profile must equal the authoritative rebuild of the union.
  applyResultStats(SURVIVOR, G1, 'win');
  applyLpResult({ playerId: SURVIVOR, gameId: G1, result: 'win', idempotencyKey: 'conflict:s:lp' });
  applyResultStats(CHANNEL, G1, 'win');
  applyLpResult({ playerId: CHANNEL, gameId: G1, result: 'win', idempotencyKey: 'conflict:l:lp' });
  applyEloResult({ playerId: CHANNEL, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'conflict:l:elo' });

  assertEqual(countWhere('competitive_profiles', SURVIVOR), 1, 'survivor profile pre-merge');
  assertEqual(countWhere('competitive_profiles', CHANNEL), 1, 'legacy profile pre-merge');

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'x');
  assertEqual(res.playerId, SURVIVOR, 'canonical');

  assertEqual(countWhere('competitive_profiles', SURVIVOR), 1, 'exactly one profile');
  assertEqual(countWhere('competitive_profiles', CHANNEL), 0, 'no orphaned profile');
  assertEqual(countWhere('lp_transactions', SURVIVOR), 2, 'both LP rows preserved');
  assertEqual(countWhere('elo_transactions', SURVIVOR), 1, 'Elo row preserved');

  // Replayed from the combined ledger: two wins ⇒ 50 LP, 2-0, no fabrication.
  const profile = getProfile(SURVIVOR, G1)!;
  assertEqual(profile.lp, 50, 'combined LP replay');
  assertEqual(profile.wins, 2, 'two wins preserved');
  assertEqual(profile.losses, 0, 'no fabricated loss');
  assertEqual(profile.matches_played, 2, 'two matches (no fabrication)');
  assertEqual(profile.elo, 1216, 'combined Elo replay');
});

test('7 — same-tournament duplicate participants reconcile to one', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});
  seedTournament({ id: 't7', gameId: G1, status: 'active', createdBy: 'admin' });
  const ins = getDb().prepare(
    'INSERT INTO tournament_participants (tournament_id, player_id, source, registered_at, ticket_ref, status) VALUES (?, ?, ?, ?, NULL, ?)'
  );
  ins.run('t7', SURVIVOR, 'admin', Date.now(), 'registered');
  ins.run('t7', CHANNEL, 'admin', Date.now(), 'registered');
  seedTournamentMatch('tm7', 't7');
  getDb()
    .prepare('INSERT INTO tournament_match_participants (match_id, player_id, slot, seed, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('tm7', CHANNEL, 1, 1, Date.now());

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'x');
  assertEqual(res.playerId, SURVIVOR, 'canonical');
  assertEqual(countWhere('tournament_participants', CHANNEL), 0, 'legacy participant removed');
  assertEqual(countWhere('tournament_participants', SURVIVOR), 1, 'one logical participant');
  assertEqual(countWhere('tournament_match_participants', CHANNEL), 0, 'legacy match ref removed');
  assertEqual(countWhere('tournament_match_participants', SURVIVOR), 1, 'bracket ref migrated');
});

test('8 — duplicate achievement rows merge without duplication', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});
  const now = Date.now();
  const ins = getDb().prepare('INSERT INTO player_achievements (player_id, achievement_id, awarded_at) VALUES (?, ?, ?)');
  ins.run(SURVIVOR, 'first_match', now);
  ins.run(CHANNEL, 'first_match', now + 1);
  ins.run(CHANNEL, 'first_win', now + 2);

  const res = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'x');
  assertEqual(res.playerId, SURVIVOR, 'canonical');
  assertEqual(countWhere('player_achievements', SURVIVOR), 2, 'distinct achievements preserved, duplicate dropped');
  assertEqual(countWhere('player_achievements', CHANNEL), 0, 'legacy achievements gone');
  assertTrue(
    !!getDb().prepare("SELECT 1 FROM player_achievements WHERE player_id = ? AND achievement_id = 'first_win'").get(SURVIVOR),
    'first_win preserved'
  );
});

test('9 — claim flow reconciles a bot + legacy pair without index collision', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL, name: 'Falfoos' });
  seedGuest(CHANNEL, { name: '@Falfoos' });
  const user = { id: 'admin', displayName: 'Admin', role: 'admin' as const };

  const outcome = claimGuestForUser(user, CHANNEL, 'Falfoos');
  assertEqual(outcome.status, 'claimed', 'claimed');
  assertEqual(outcome.playerId, SURVIVOR, 'canonical survivor');
  assertNull(getGuestRaw(CHANNEL), 'legacy removed');
  assertEqual(getGuestRaw(SURVIVOR)!.claimed_user_id, 'admin', 'claim bound to survivor');
  assertEqual(guestsWithChannel(CHANNEL), 1, 'one identity');
});

test('10 — unknown channel creates exactly one UUID and is idempotent', () => {
  wipeAll();
  const first = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'New Player');
  assertEqual(first.created, true, 'created');
  assertTrue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(first.playerId), 'uuid v4');
  assertEqual(guestsWithChannel(CHANNEL), 1, 'one channel row');
  assertEqual(countAll('guests'), 1, 'one guest');

  const second = resolveOrCreatePlayerByYouTubeChannelId(CHANNEL, 'New Player');
  assertEqual(second.playerId, first.playerId, 'same canonical id');
  assertEqual(second.created, false, 'not recreated');
  assertEqual(countAll('guests'), 1, 'still one guest');
});

test('11 — a forced merge failure rolls back every partial change', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL });
  seedGuest(CHANNEL, {});
  seedMatch(MATCH);
  getDb()
    .prepare('INSERT INTO score_events (match_id, player_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(MATCH, CHANNEL, 10, 'test', Date.now());

  getDb().exec("CREATE TRIGGER id_test_abort BEFORE UPDATE ON score_events BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  try {
    assertThrows(() => mergePlayerIdentities(SURVIVOR, CHANNEL), 'merge must throw');
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS id_test_abort');
  }

  assertTrue(!!getGuestRaw(SURVIVOR), 'survivor intact');
  assertTrue(!!getGuestRaw(CHANNEL), 'duplicate intact');
  assertEqual(countWhere('score_events', CHANNEL), 1, 'score still owned by duplicate');
  assertEqual(countWhere('score_events', SURVIVOR), 0, 'nothing partially migrated');
});

test('12 — findLinkedPlayerForUser ignores a channel-less synthetic artifact', () => {
  wipeAll();
  seedGuest('user:admin', { claimed: 'admin' });
  assertNull(findLinkedPlayerForUser('admin'), 'channel-less artifact is not a canonical link');
});

test('13 — findLinkedPlayerForUser returns the channel-backed canonical Player', () => {
  wipeAll();
  seedGuest(SURVIVOR, { channel: CHANNEL, claimed: 'admin', name: 'Falfoos' });
  const linked = findLinkedPlayerForUser('admin');
  assertTrue(!!linked, 'canonical Player found');
  assertEqual(linked!.player_id, SURVIVOR, 'channel-backed id');
  assertEqual(linked!.youtube_channel_id, CHANNEL, 'channel returned');
  assertEqual(linked!.display_name, 'Falfoos', 'display name returned');
});

cleanupTestDb();
summarize('IdentityService');
