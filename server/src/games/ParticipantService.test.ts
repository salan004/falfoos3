/**
 * ParticipantService — participant_count integrity tests.
 *
 * Proves that registerParticipantTransactional keeps tournaments.participant_count
 * in sync for both unlimited (max_participants = NULL) and limited tournaments,
 * and that failures/duplicates never leave a stray increment.
 *
 * Run: `ts-node src/games/ParticipantService.test.ts` (wired into `npm run test`).
 */

import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import { seedGame, seedPlayer, seedTournament, seedUser } from '../competitive/competitiveTestSeed';
import { cancelParticipant, registerParticipantTransactional } from './ParticipantService';
import { assertEqual, assertTrue, summarize, test } from '../competitive/testHarness';

const GAME = 'participant-test-game';
const ADMIN = 'participant-test-admin';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');
seedUser(ADMIN);
seedGame(GAME, 'participant-test-slug');

let counter = 0;

function reset(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
  })();
}

function makeTournament(maxParticipants: number | null, status: 'open' | 'draft' = 'open'): string {
  counter += 1;
  const id = `ptour-${counter}`;
  seedTournament({ id, gameId: GAME, status, createdBy: ADMIN, maxParticipants });
  return id;
}

function makePlayer(): string {
  counter += 1;
  const playerId = `pplayer-${counter}`;
  seedPlayer(playerId, `Player ${counter}`);
  return playerId;
}

function participantCountOf(tournamentId: string): number {
  const row = getDb()
    .prepare('SELECT participant_count FROM tournaments WHERE id = ?')
    .get(tournamentId) as { participant_count: number } | undefined;
  return row?.participant_count ?? -1;
}

function participantRows(tournamentId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tournament_participants WHERE tournament_id = ?')
    .get(tournamentId) as { n: number };
  return row.n;
}

test('A — unlimited tournament increments participant_count', () => {
  reset();
  const tournamentId = makeTournament(null);
  const playerId = makePlayer();

  const result = registerParticipantTransactional(tournamentId, playerId, 'purchase', 'evt-a');

  assertEqual(result.success, true, 'registration succeeded');
  assertEqual(participantRows(tournamentId), 1, 'one participant row');
  assertEqual(participantCountOf(tournamentId), 1, 'participant_count = 1');
});

test('B — unlimited tournament counts multiple registrations', () => {
  reset();
  const tournamentId = makeTournament(null);

  registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-b1');
  registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-b2');

  assertEqual(participantRows(tournamentId), 2, 'two participant rows');
  assertEqual(participantCountOf(tournamentId), 2, 'participant_count = 2');
});

test('C — limited tournament counts registrations up to capacity', () => {
  reset();
  const tournamentId = makeTournament(2);

  const first = registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-c1');
  const second = registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-c2');

  assertEqual(first.success, true, 'first succeeded');
  assertEqual(second.success, true, 'second succeeded');
  assertEqual(participantCountOf(tournamentId), 2, 'participant_count = 2');
});

test('D — full limited tournament rejects the third and keeps count', () => {
  reset();
  const tournamentId = makeTournament(2);

  registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-d1');
  registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-d2');
  const third = registerParticipantTransactional(tournamentId, makePlayer(), 'purchase', 'evt-d3');

  assertEqual(third.success, false, 'third registration failed');
  assertEqual(third.error, 'Tournament is full', 'full error reported');
  assertEqual(participantCountOf(tournamentId), 2, 'participant_count remains 2');
  assertEqual(participantRows(tournamentId), 2, 'no third participant row');
});

test('E — duplicate registration does not increase participant_count twice', () => {
  reset();
  const tournamentId = makeTournament(null);
  const playerId = makePlayer();

  const first = registerParticipantTransactional(tournamentId, playerId, 'purchase', 'evt-e');
  const second = registerParticipantTransactional(tournamentId, playerId, 'purchase', 'evt-e');

  assertEqual(first.success, true, 'first succeeded');
  assertEqual(second.success, false, 'duplicate rejected');
  assertTrue((second.error ?? '').includes('already registered'), 'duplicate error reported');
  assertEqual(participantCountOf(tournamentId), 1, 'participant_count not increased twice');
  assertEqual(participantRows(tournamentId), 1, 'still one participant row');
});

test('F — failed registration leaves participant_count unchanged', () => {
  reset();
  const closedTournament = makeTournament(5, 'draft');
  const playerId = makePlayer();

  const result = registerParticipantTransactional(closedTournament, playerId, 'purchase', 'evt-f');

  assertEqual(result.success, false, 'registration failed');
  assertEqual(participantCountOf(closedTournament), 0, 'participant_count unchanged');
  assertEqual(participantRows(closedTournament), 0, 'no participant row');
});

test('F2 — unknown tournament registration fails without side effects', () => {
  reset();
  const result = registerParticipantTransactional('does-not-exist', makePlayer(), 'purchase', 'evt-f2');

  assertEqual(result.success, false, 'registration failed');
  assertEqual(result.error, 'Tournament not found', 'not-found error reported');
});

test('G — cancelling a participant decrements participant_count', () => {
  reset();
  const tournamentId = makeTournament(null);
  const playerId = makePlayer();

  registerParticipantTransactional(tournamentId, playerId, 'purchase', 'evt-g');
  assertEqual(participantCountOf(tournamentId), 1, 'count is 1 before cancel');

  const cancelled = cancelParticipant(tournamentId, playerId);

  assertEqual(cancelled, true, 'cancel succeeded');
  assertEqual(participantCountOf(tournamentId), 0, 'participant_count decremented');
});

cleanupTestDb();
summarize('ParticipantService');
