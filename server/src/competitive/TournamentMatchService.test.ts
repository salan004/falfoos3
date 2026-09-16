/**
 * Phase 4C — TournamentMatchService tests: result processing, advancement,
 * idempotency, atomicity, state machine, disputes, cross-game isolation.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanCompetitive,
  cleanTournaments,
  countRows,
  seedGame,
  seedPlayer,
  seedTournament,
  seedTournamentParticipant,
  seedUser,
} from './competitiveTestSeed';
import { generateBracket, getTournamentBracket } from './BracketService';
import {
  cancelMatch,
  getMatch,
  getMatchParticipants,
  getTournamentChampion,
  getTournamentMatches,
  openDispute,
  recordMatchResult,
  resolveDispute,
  setMatchStatus,
  startMatch,
  TournamentMatchError,
} from './TournamentMatchService';
import { applyAdminLpAdjustment } from './LpService';
import { getProfile } from './CompetitiveProfileService';
import { assertEqual, assertNull, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const ADMIN = 'admin-user-1';
const DG = 'game-dg';
const RL = 'game-rl';
seedUser(ADMIN);
seedGame(DG, 'dueling_grounds');
seedGame(RL, 'rocket_league');
cleanCompetitive();
cleanTournaments();

let counter = 0;
function setupTournament(gameId: string, playerCount: number): { tournamentId: string; players: string[] } {
  counter += 1;
  const tournamentId = `t-${counter}`;
  seedTournament({ id: tournamentId, gameId, status: 'open', createdBy: ADMIN });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `p-${counter}-${String(i + 1).padStart(3, '0')}`;
    seedPlayer(pid, `Player ${i + 1}`);
    seedTournamentParticipant(tournamentId, pid);
    players.push(pid);
  }
  generateBracket(tournamentId);
  return { tournamentId, players };
}

function codeOf(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return err instanceof TournamentMatchError ? err.code : `unknown:${String(err)}`;
  }
  return 'no-error';
}

function stateSnapshot(tournamentId: string): string {
  const db = getDb();
  return JSON.stringify({
    tournament: db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId),
    matches: db.prepare('SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY id').all(tournamentId),
    matchParticipants: db.prepare('SELECT * FROM tournament_match_participants ORDER BY match_id, slot').all(),
    profiles: db.prepare('SELECT * FROM competitive_profiles ORDER BY player_id, game_id').all(),
    lp: db.prepare('SELECT * FROM lp_transactions ORDER BY id').all(),
    elo: db.prepare('SELECT * FROM elo_transactions ORDER BY id').all(),
  });
}

console.log('=== TournamentMatchService ===');

test('recording a final result updates LP, Elo, stats and completes the tournament', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const [a, b] = players;
  applyAdminLpAdjustment({ playerId: a, gameId: DG, amount: 100, idempotencyKey: `seed:${a}` });
  applyAdminLpAdjustment({ playerId: b, gameId: DG, amount: 100, idempotencyKey: `seed:${b}` });

  const match = getTournamentMatches(tournamentId)[0];
  assertEqual(match.round_no, 1, 'final is round 1 for a 2-player bracket');
  assertNull(match.next_match_id, 'final has no next match');

  const outcome = recordMatchResult({ matchId: match.id, winnerPlayerId: a });
  assertTrue(!outcome.alreadyProcessed, 'not a replay');
  assertTrue(outcome.tournamentCompleted, 'tournament completed');
  assertEqual(outcome.championPlayerId, a, 'champion is the final winner');
  assertEqual(getTournamentChampion(tournamentId), a, 'champion read back');

  const completed = getMatch(match.id)!;
  assertEqual(completed.status, 'completed', 'match completed');
  assertEqual(completed.winner_player_id, a, 'winner stored');
  assertTrue(completed.completed_at !== null, 'completed_at set');

  const winner = getProfile(a, DG)!;
  const loser = getProfile(b, DG)!;
  assertEqual(winner.lp, 125, 'winner +25 LP');
  assertEqual(loser.lp, 80, 'loser -20 LP');
  assertEqual(winner.elo, 1216, 'winner Elo +16');
  assertEqual(loser.elo, 1184, 'loser Elo -16');
  assertEqual(winner.matches_played, 1, 'winner matches');
  assertEqual(winner.wins, 1, 'winner wins');
  assertEqual(loser.matches_played, 1, 'loser matches');
  assertEqual(loser.losses, 1, 'loser losses');

  const tournamentRow = getDb().prepare('SELECT status FROM tournaments WHERE id = ?').get(tournamentId) as { status: string };
  assertEqual(tournamentRow.status, 'completed', 'tournament status');
});

test('player B can win instead of player A', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const [a, b] = players;
  const match = getTournamentMatches(tournamentId)[0];
  const outcome = recordMatchResult({ matchId: match.id, winnerPlayerId: b });
  assertEqual(outcome.winnerPlayerId, b, 'B recorded as winner');
  assertEqual(getMatch(match.id)!.winner_player_id, b, 'B stored');
  assertEqual(getTournamentChampion(tournamentId), b, 'B champion');
  assertEqual(getProfile(a, DG)!.losses, 1, 'A lost');
  assertEqual(getProfile(b, DG)!.wins, 1, 'B won');
});

test('4-player bracket: winners advance and the final crowns a champion', () => {
  const { tournamentId, players } = setupTournament(DG, 4);
  const semis = getTournamentMatches(tournamentId).filter((m) => m.round_no === 1);
  assertEqual(semis.length, 2, 'two semifinals');

  const winners: string[] = [];
  for (const semi of semis) {
    const parts = getMatchParticipants(semi.id);
    assertEqual(parts.length, 2, 'semi has two players');
    const winner = parts[0].player_id;
    winners.push(winner);
    const outcome = recordMatchResult({ matchId: semi.id, winnerPlayerId: winner });
    assertTrue(outcome.advanced, 'semi winner advanced');
    assertTrue(outcome.nextMatchId !== null, 'has next match');
    const nextParticipants = getMatchParticipants(outcome.nextMatchId!);
    assertTrue(
      nextParticipants.some((p) => p.player_id === winner && p.slot === outcome.nextMatchSlot),
      'winner placed in the recorded next slot'
    );
  }

  const final = getTournamentMatches(tournamentId).find((m) => m.round_no === 2)!;
  assertEqual(getMatchParticipants(final.id).length, 2, 'final has two participants');
  assertEqual(getMatch(final.id)!.next_match_id, null, 'final has no next match');

  const finalWinner = getMatchParticipants(final.id)[0].player_id;
  const outcome = recordMatchResult({ matchId: final.id, winnerPlayerId: finalWinner });
  assertTrue(outcome.tournamentCompleted, 'tournament completed');
  assertEqual(getTournamentChampion(tournamentId), finalWinner, 'champion recorded');

  const championProfile = getProfile(finalWinner, DG)!;
  assertEqual(championProfile.wins, 2, 'champion won semi + final');
  assertEqual(championProfile.matches_played, 2, 'champion played two matches');
  assertTrue(winners.includes(finalWinner), 'champion came through a semi');
});

test('result submission is idempotent for the same key', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];
  const key = `match:${match.id}:result`;
  const first = recordMatchResult({ matchId: match.id, winnerPlayerId: players[0], idempotencyKey: key });
  assertTrue(!first.alreadyProcessed, 'first applied');

  const lpCount = countRows('lp_transactions');
  const eloCount = countRows('elo_transactions');
  const afterFirst = stateSnapshot(tournamentId);

  const second = recordMatchResult({ matchId: match.id, winnerPlayerId: players[0], idempotencyKey: key });
  assertTrue(second.alreadyProcessed, 'second is a replay');
  assertEqual(stateSnapshot(tournamentId), afterFirst, 'no state change on replay');
  assertEqual(countRows('lp_transactions'), lpCount, 'LP applied once');
  assertEqual(countRows('elo_transactions'), eloCount, 'Elo applied once');

  // Per-player ledger keys exist exactly once.
  const lpForKey = getDb()
    .prepare('SELECT COUNT(*) AS n FROM lp_transactions WHERE idempotency_key = ?')
    .get(`match:${match.id}:${players[0]}:lp`) as { n: number };
  assertEqual(lpForKey.n, 1, 'winner LP ledger row once');
});

test('a completed match rejects a different result', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0], idempotencyKey: 'first' });
  assertEqual(
    codeOf(() => recordMatchResult({ matchId: match.id, winnerPlayerId: players[1], idempotencyKey: 'second' })),
    'match_already_completed',
    'duplicate result rejected'
  );
});

test('winner must be one of the match participants', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];
  seedPlayer('outsider');
  assertEqual(
    codeOf(() => recordMatchResult({ matchId: match.id, winnerPlayerId: 'outsider' })),
    'winner_not_participant',
    'outsider rejected'
  );
});

test('match state machine rejects invalid transitions', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];

  assertEqual(codeOf(() => setMatchStatus(match.id, 'completed')), 'invalid_transition', 'pending→completed blocked');
  assertEqual(codeOf(() => setMatchStatus(match.id, 'scheduled')), 'no-error', 'pending→scheduled ok');

  startMatch(match.id);
  assertEqual(getMatch(match.id)!.status, 'active', 'started');
  assertEqual(codeOf(() => setMatchStatus(match.id, 'pending')), 'invalid_transition', 'active→pending blocked');

  cancelMatch(match.id);
  assertEqual(getMatch(match.id)!.status, 'cancelled', 'cancelled');
  assertEqual(codeOf(() => setMatchStatus(match.id, 'active')), 'invalid_transition', 'cancelled→active blocked');
  assertEqual(codeOf(() => setMatchStatus(match.id, 'completed')), 'invalid_transition', 'cancelled→completed blocked');
  assertEqual(codeOf(() => recordMatchResult({ matchId: match.id, winnerPlayerId: 'x' })), 'match_cancelled', 'cancelled result blocked');
});

test('completed matches cannot be re-activated or rescheduled', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  assertEqual(codeOf(() => setMatchStatus(match.id, 'active')), 'invalid_transition', 'completed→active blocked');
  assertEqual(codeOf(() => setMatchStatus(match.id, 'scheduled')), 'invalid_transition', 'completed→scheduled blocked');
});

test('disputes block normal result processing without destroying history', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const match = getTournamentMatches(tournamentId)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });

  openDispute(match.id);
  assertEqual(getMatch(match.id)!.status, 'disputed', 'disputed');
  assertEqual(getMatch(match.id)!.winner_player_id, players[0], 'winner history preserved');
  assertEqual(
    codeOf(() => recordMatchResult({ matchId: match.id, winnerPlayerId: players[1] })),
    'match_disputed',
    'disputed result blocked'
  );

  // Reversing applied effects is intentionally deferred (safe refusal).
  assertEqual(codeOf(() => resolveDispute(match.id, 'cancelled')), 'correction_deferred', 'cancellation deferred');
  resolveDispute(match.id, 'completed');
  assertEqual(getMatch(match.id)!.status, 'completed', 'dispute resolved to completed');
});

test('cross-game isolation: a Dueling Grounds match never touches Rocket League', () => {
  counter += 1;
  const dgId = `cross-dg-${counter}`;
  const rlId = `cross-rl-${counter}`;
  seedTournament({ id: dgId, gameId: DG, status: 'open', createdBy: ADMIN });
  seedTournament({ id: rlId, gameId: RL, status: 'open', createdBy: ADMIN });
  const players = [`cross-a-${counter}`, `cross-b-${counter}`];
  for (const pid of players) {
    seedPlayer(pid, pid);
    seedTournamentParticipant(dgId, pid);
    seedTournamentParticipant(rlId, pid);
  }
  generateBracket(dgId);
  generateBracket(rlId);

  const dgMatch = getTournamentMatches(dgId)[0];
  recordMatchResult({ matchId: dgMatch.id, winnerPlayerId: players[0] });

  assertTrue(getProfile(players[0], DG)!.lp > 0, 'DG profile updated');
  assertNull(getProfile(players[0], RL), 'RL profile untouched (never created)');
  assertNull(getProfile(players[1], RL), 'RL opponent untouched');
});

test('atomic result: forced failures at each stage fully roll back', () => {
  const triggers: { name: string; sql: string; needNext: boolean }[] = [
    {
      name: 'trg_match_update',
      sql: "CREATE TRIGGER trg_match_update BEFORE UPDATE ON tournament_matches BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: false,
    },
    {
      name: 'trg_lp_insert',
      sql: "CREATE TRIGGER trg_lp_insert BEFORE INSERT ON lp_transactions BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: false,
    },
    {
      name: 'trg_elo_insert',
      sql: "CREATE TRIGGER trg_elo_insert BEFORE INSERT ON elo_transactions BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: false,
    },
    {
      name: 'trg_stats_update',
      sql: "CREATE TRIGGER trg_stats_update BEFORE UPDATE OF matches_played ON competitive_profiles BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: false,
    },
    {
      name: 'trg_advance_insert',
      sql: "CREATE TRIGGER trg_advance_insert BEFORE INSERT ON tournament_match_participants BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: true,
    },
    {
      name: 'trg_tournament_update',
      sql: "CREATE TRIGGER trg_tournament_update BEFORE UPDATE ON tournaments BEGIN SELECT RAISE(ABORT, 'boom'); END;",
      needNext: false,
    },
  ];

  for (const trigger of triggers) {
    // Tournament completion failure must target the FINAL; advancement targets a
    // first-round match with a next match.
    const playerCount = trigger.needNext ? 4 : 2;
    const { tournamentId, players } = setupTournament(DG, playerCount);
    const match = trigger.needNext
      ? getTournamentMatches(tournamentId).find((m) => m.round_no === 1 && m.next_match_id !== null)!
      : getTournamentMatches(tournamentId)[0];
    const winner = getMatchParticipants(match.id)[0].player_id;
    const before = stateSnapshot(tournamentId);

    getDb().exec(trigger.sql);
    try {
      assertThrows(
        () => recordMatchResult({ matchId: match.id, winnerPlayerId: winner, idempotencyKey: `rollback:${trigger.name}` }),
        `expected failure: ${trigger.name}`
      );
    } finally {
      getDb().exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }

    assertEqual(getMatch(match.id)!.status, 'pending', `match unchanged: ${trigger.name}`);
    assertEqual(stateSnapshot(tournamentId), before, `full rollback: ${trigger.name}`);
    assertEqual(countRows('lp_transactions'), (JSON.parse(before).lp as unknown[]).length, `LP unchanged: ${trigger.name}`);
    void players;
  }
});

cleanupTestDb();
summarize('TournamentMatchService');
