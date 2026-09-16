/**
 * Phase 4F — real-time event bus tests: events are published only after a
 * successful commit, carry the required identifiers, are not duplicated by an
 * idempotent replay, and never fire on rollback.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanCompetitive,
  cleanTournaments,
  seedGame,
  seedPlayer,
  seedTournament,
  seedTournamentParticipant,
  seedUser,
} from './competitiveTestSeed';
import { generateBracket } from './BracketService';
import {
  getMatchParticipants,
  getTournamentMatches,
  recordMatchResult,
} from './TournamentMatchService';
import { correctMatchResult } from './MatchCorrectionService';
import { onCompetitiveEvent, type CompetitiveEvent } from './competitiveEvents';
import { assertEqual, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const ADMIN = 'evt-admin';
const DG = 'evt-game-dg';
seedUser(ADMIN);
seedGame(DG, 'dueling_grounds');
cleanCompetitive();
cleanTournaments();

let events: CompetitiveEvent[] = [];
const unsubscribe = onCompetitiveEvent((e) => events.push(e));
function reset(): void {
  events = [];
}
function types(): string[] {
  return events.map((e) => e.type);
}

let counter = 0;
function setupTournament(playerCount: number): { tournamentId: string; players: string[] } {
  counter += 1;
  const tournamentId = `evt-${counter}`;
  seedTournament({ id: tournamentId, gameId: DG, status: 'open', createdBy: ADMIN });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `evtp-${counter}-${i + 1}`;
    seedPlayer(pid, `P${i + 1}`);
    seedTournamentParticipant(tournamentId, pid);
    players.push(pid);
  }
  generateBracket(tournamentId);
  return { tournamentId, players };
}

console.log('=== CompetitiveEvents (real-time) ===');

test('bracket generation emits bracket.updated and tournament.updated after commit', () => {
  reset();
  const { tournamentId } = setupTournament(2);
  assertTrue(types().includes('bracket.updated'), 'bracket.updated emitted');
  assertTrue(types().includes('tournament.updated'), 'tournament.updated emitted');
  const evt = events.find((e) => e.type === 'bracket.updated')!;
  assertEqual(evt.tournamentId, tournamentId, 'tournamentId present');
  assertEqual(evt.gameId, DG, 'gameId present');
  assertTrue(typeof evt.at === 'number', 'timestamp present');
});

test('recording a result emits match/tournament/profile events with identifiers', () => {
  reset();
  const { tournamentId } = setupTournament(2);
  const match = getTournamentMatches(tournamentId)[0];
  const winner = getMatchParticipants(match.id)[0].player_id;
  recordMatchResult({ matchId: match.id, winnerPlayerId: winner });

  assertTrue(types().includes('match.updated'), 'match.updated');
  assertTrue(types().includes('tournament.updated'), 'tournament.updated');
  assertTrue(types().includes('competitive_profile.updated'), 'competitive_profile.updated');
  assertTrue(types().includes('tournament.completed'), 'tournament.completed for the final');

  const matchEvt = events.find((e) => e.type === 'match.updated')!;
  assertEqual(matchEvt.matchId, match.id, 'matchId');
  assertEqual(matchEvt.tournamentId, tournamentId, 'tournamentId');
  const profileEvt = events.find((e) => e.type === 'competitive_profile.updated')!;
  assertEqual(profileEvt.gameId, DG, 'profile gameId');
  assertTrue(typeof profileEvt.playerId === 'string', 'profile playerId');
});

test('an idempotent replay emits no events', () => {
  const { tournamentId } = setupTournament(2);
  const match = getTournamentMatches(tournamentId)[0];
  const winner = getMatchParticipants(match.id)[0].player_id;
  const key = `evt:${match.id}`;
  recordMatchResult({ matchId: match.id, winnerPlayerId: winner, idempotencyKey: key });
  reset();
  recordMatchResult({ matchId: match.id, winnerPlayerId: winner, idempotencyKey: key });
  assertEqual(events.length, 0, 'no events on replay');
});

test('a rolled-back transaction emits no events', () => {
  const { tournamentId } = setupTournament(2);
  const match = getTournamentMatches(tournamentId)[0];
  const winner = getMatchParticipants(match.id)[0].player_id;
  reset();
  getDb().exec(
    "CREATE TRIGGER evt_abort BEFORE INSERT ON lp_transactions BEGIN SELECT RAISE(ABORT, 'boom'); END;"
  );
  try {
    assertThrows(
      () => recordMatchResult({ matchId: match.id, winnerPlayerId: winner, idempotencyKey: `evt-rollback:${match.id}` }),
      'expected failure'
    );
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS evt_abort');
  }
  assertEqual(events.length, 0, 'no events emitted on rollback');
});

test('a correction emits match.corrected plus refresh signals after commit', () => {
  const { tournamentId } = setupTournament(2);
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  const a = parts[0].player_id;
  const b = parts[1].player_id;
  recordMatchResult({ matchId: match.id, winnerPlayerId: a });
  reset();
  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: b, reason: 'event test' });
  assertTrue(types().includes('match.corrected'), 'match.corrected');
  assertTrue(types().includes('match.updated'), 'match.updated');
  assertTrue(types().includes('bracket.updated'), 'bracket.updated');
  assertTrue(types().includes('tournament.updated'), 'tournament.updated');
  assertTrue(types().includes('competitive_profile.updated'), 'competitive_profile.updated');
  const corrected = events.find((e) => e.type === 'match.corrected')!;
  assertEqual(corrected.tournamentId, tournamentId, 'correction tournamentId');
  assertEqual(corrected.matchId, match.id, 'correction matchId');
});

unsubscribe();
cleanupTestDb();
summarize('CompetitiveEvents');
