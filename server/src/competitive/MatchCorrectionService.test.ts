/**
 * Phase 4F — MatchCorrectionService tests: safe, atomic, idempotent correction
 * of completed results, deterministic rebuild, bracket reconciliation,
 * downstream protection, champion correction, auditability and isolation.
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
  getMatch,
  getMatchParticipants,
  getTournamentChampion,
  getTournamentMatches,
  recordMatchResult,
  setMatchStatus,
} from './TournamentMatchService';
import {
  MatchCorrectionError,
  correctMatchResult,
} from './MatchCorrectionService';
import { deriveProfileState, rebuildProfile, snapshotProfile } from './CompetitiveRebuildService';
import { getProfile } from './CompetitiveProfileService';
import { assertEqual, assertNull, assertThrows, assertTrue, summarize, test } from './testHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const ADMIN = 'corr-admin';
const DG = 'corr-game-dg';
const RL = 'corr-game-rl';
seedUser(ADMIN);
seedGame(DG, 'dueling_grounds');
seedGame(RL, 'rocket_league');
cleanCompetitive();
cleanTournaments();

let counter = 0;
function setupTournament(gameId: string, playerCount: number): { tournamentId: string; players: string[] } {
  counter += 1;
  const tournamentId = `c-${counter}`;
  seedTournament({ id: tournamentId, gameId, status: 'open', createdBy: ADMIN });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `cp-${counter}-${String(i + 1).padStart(3, '0')}`;
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
    return err instanceof MatchCorrectionError ? err.code : `unknown:${String(err)}`;
  }
  return 'no-error';
}

function correctionCount(matchId: string): number {
  return (
    getDb()
      .prepare('SELECT COUNT(*) AS n FROM match_result_corrections WHERE match_id = ?')
      .get(matchId) as { n: number }
  ).n;
}

/** Only the two finalists of a freshly generated 2-player bracket. */
function finalPair(tournamentId: string): { matchId: string; a: string; b: string } {
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  return { matchId: match.id, a: parts[0].player_id!, b: parts[1].player_id! };
}

console.log('=== MatchCorrectionService ===');

test('Win → Loss: reversed LP/Elo/stats and champion', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  assertEqual(getTournamentChampion(tournamentId), a, 'pre-champion');

  const outcome = correctMatchResult({
    matchId,
    correctedWinnerPlayerId: b,
    reason: 'wrong winner reported',
    actorId: ADMIN,
  });
  assertTrue(outcome.changed, 'changed');
  assertTrue(!outcome.alreadyProcessed, 'applied');
  assertEqual(outcome.correctedWinnerPlayerId, b, 'corrected winner');
  assertEqual(getMatch(matchId)!.winner_player_id, b, 'match winner corrected');
  assertEqual(getTournamentChampion(tournamentId), b, 'champion corrected');

  const pa = getProfile(a, DG)!;
  const pb = getProfile(b, DG)!;
  assertEqual(pa.lp, 0, 'A LP: 0 (loss floored from 0)');
  assertEqual(pb.lp, 25, 'B LP: +25 win');
  assertEqual(pa.elo, 1184, 'A Elo -16');
  assertEqual(pb.elo, 1216, 'B Elo +16');
  assertEqual(pa.wins, 0, 'A wins 0');
  assertEqual(pa.losses, 1, 'A losses 1');
  assertEqual(pb.wins, 1, 'B wins 1');
  assertEqual(pb.losses, 0, 'B losses 0');
  assertEqual(pa.matches_played, 1, 'A played 1');
});

test('correction is deterministic: materialized profile equals ledger rebuild', () => {
  // Reuse the previous tournament's players by re-reading profiles: rebuild is
  // a no-op when the materialized state already matches the ledgers.
  const rows = getDb().prepare('SELECT player_id, game_id FROM competitive_profiles').all() as {
    player_id: string;
    game_id: string;
  }[];
  assertTrue(rows.length > 0, 'profiles exist');
  for (const row of rows) {
    const derived = deriveProfileState(row.player_id, row.game_id);
    assertEqual(JSON.stringify(snapshotProfile(row.player_id, row.game_id)), JSON.stringify(derived), 'derive == materialized');
    const result = rebuildProfile(row.player_id, row.game_id);
    assertTrue(!result.changed, 'rebuild is a no-op after correction');
  }
});

test('Win → Draw: no winner, both draw, champion cleared', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  const outcome = correctMatchResult({ matchId, correctedWinnerPlayerId: null, reason: 'match voided as draw' });
  assertEqual(outcome.correctedWinnerPlayerId, null, 'draw');
  assertNull(getMatch(matchId)!.winner_player_id, 'no winner stored');
  assertNull(getTournamentChampion(tournamentId), 'no champion');
  assertTrue(!outcome.tournamentCompleted, 'no tournament completion on draw');

  const pa = getProfile(a, DG)!;
  const pb = getProfile(b, DG)!;
  assertEqual(pa.lp, 0, 'A LP 0');
  assertEqual(pb.lp, 0, 'B LP 0');
  assertEqual(pa.elo, 1200, 'A Elo restored to 1200');
  assertEqual(pb.elo, 1200, 'B Elo restored to 1200');
  assertEqual(pa.draws, 1, 'A draw');
  assertEqual(pb.draws, 1, 'B draw');
  assertEqual(pa.wins, 0, 'A no wins');
  assertEqual(pb.losses, 0, 'B no losses');
});

test('Draw → Win: a second correction re-applies a winner', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  correctMatchResult({ matchId, correctedWinnerPlayerId: null, reason: 'draw first' });
  const outcome = correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'actually B won' });
  assertEqual(outcome.correctedWinnerPlayerId, b, 'B corrected winner');
  assertEqual(getTournamentChampion(tournamentId), b, 'B champion');
  const pb = getProfile(b, DG)!;
  const pa = getProfile(a, DG)!;
  assertEqual(pb.lp, 25, 'B LP +25');
  assertEqual(pb.wins, 1, 'B wins 1');
  assertEqual(pb.draws, 0, 'B draws 0');
  assertEqual(pa.losses, 1, 'A losses 1');
  assertEqual(pa.draws, 0, 'A draws 0');
  assertEqual(pb.elo, 1216, 'B Elo +16');
  assertEqual(pa.elo, 1184, 'A Elo -16');
});

test('Loss → Win and Draw → Loss are handled safely', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  // A wins → draw → A wins again (a Draw → … → Win chain)
  correctMatchResult({ matchId, correctedWinnerPlayerId: null, reason: 'draw' });
  correctMatchResult({ matchId, correctedWinnerPlayerId: a, reason: 'A actually won' });
  assertEqual(getTournamentChampion(tournamentId), a, 'A champion');
  assertEqual(getProfile(a, DG)!.wins, 1, 'A 1 win');
  assertEqual(getProfile(b, DG)!.losses, 1, 'B 1 loss');
  assertEqual(getProfile(a, DG)!.draws, 0, 'A 0 draws');
});

test('correction is idempotent for the same key', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  const key = `fix:${matchId}`;
  const first = correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'fix', idempotencyKey: key });
  assertTrue(!first.alreadyProcessed, 'first applied');

  const lpCount = (getDb().prepare('SELECT COUNT(*) AS n FROM lp_transactions').get() as { n: number }).n;
  const eloCount = (getDb().prepare('SELECT COUNT(*) AS n FROM elo_transactions').get() as { n: number }).n;
  const audits = correctionCount(matchId);
  const after = JSON.stringify(snapshotProfile(b, DG));

  const second = correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'fix', idempotencyKey: key });
  assertTrue(second.alreadyProcessed, 'second is a replay');
  assertTrue(!second.changed, 'replay reports unchanged');
  assertEqual((getDb().prepare('SELECT COUNT(*) AS n FROM lp_transactions').get() as { n: number }).n, lpCount, 'no extra LP rows');
  assertEqual((getDb().prepare('SELECT COUNT(*) AS n FROM elo_transactions').get() as { n: number }).n, eloCount, 'no extra Elo rows');
  assertEqual(correctionCount(matchId), audits, 'no extra audit rows');
  assertEqual(JSON.stringify(snapshotProfile(b, DG)), after, 'profile unchanged on replay');
});

test('reusing a correction key for a different correction is rejected', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'first', idempotencyKey: 'shared-key' });
  assertEqual(
    codeOf(() =>
      correctMatchResult({ matchId, correctedWinnerPlayerId: a, reason: 'second', idempotencyKey: 'shared-key' })
    ),
    'duplicate_correction',
    'key reuse rejected'
  );
});

test('only a completed match can be corrected', () => {
  const { tournamentId, players } = setupTournament(DG, 2);
  void players;
  const match = getTournamentMatches(tournamentId)[0];
  assertEqual(
    codeOf(() => correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: null, reason: 'x' })),
    'match_not_completed',
    'pending match rejected'
  );
});

test('invalid corrected winner and missing reason are rejected', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  seedPlayer('corr-outsider');
  assertEqual(
    codeOf(() => correctMatchResult({ matchId, correctedWinnerPlayerId: 'corr-outsider', reason: 'x' })),
    'invalid_corrected_winner',
    'outsider rejected'
  );
  assertEqual(
    codeOf(() => correctMatchResult({ matchId, correctedWinnerPlayerId: a, reason: '   ' })),
    'missing_reason',
    'blank reason rejected'
  );
});

test('bracket: corrected winner replaces the pending downstream participant', () => {
  const { tournamentId } = setupTournament(DG, 4);
  const semis = getTournamentMatches(tournamentId).filter((m) => m.round_no === 1);
  const semi = semis[0];
  const parts = getMatchParticipants(semi.id);
  const winner = parts[0].player_id!;
  const loser = parts[1].player_id!;
  recordMatchResult({ matchId: semi.id, winnerPlayerId: winner });

  const next = getMatch(semi.next_match_id!)!;
  const slot = semi.next_match_slot!;
  assertTrue(
    getMatchParticipants(next.id).some((p) => p.player_id === winner && p.slot === slot),
    'old winner advanced'
  );

  correctMatchResult({ matchId: semi.id, correctedWinnerPlayerId: loser, reason: 'flip' });
  const after = getMatchParticipants(next.id);
  assertTrue(after.some((p) => p.player_id === loser && p.slot === slot), 'corrected winner is in the slot');
  assertTrue(!after.some((p) => p.player_id === winner), 'old winner removed from downstream');
  assertEqual(after.filter((p) => p.slot === slot).length, 1, 'exactly one occupant in slot');
});

test('bracket: a completed downstream match protects its history', () => {
  const { tournamentId } = setupTournament(DG, 4);
  const semis = getTournamentMatches(tournamentId).filter((m) => m.round_no === 1);
  const winners: string[] = [];
  for (const semi of semis) {
    const w = getMatchParticipants(semi.id)[0].player_id!;
    winners.push(w);
    recordMatchResult({ matchId: semi.id, winnerPlayerId: w });
  }
  const final = getTournamentMatches(tournamentId).find((m) => m.round_no === 2)!;
  recordMatchResult({ matchId: final.id, winnerPlayerId: winners[0] });

  assertEqual(
    codeOf(() =>
      correctMatchResult({
        matchId: semis[0].id,
        correctedWinnerPlayerId: getMatchParticipants(semis[0].id)[1].player_id!,
        reason: 'too late',
      })
    ),
    'downstream_conflict',
    'completed downstream blocks correction'
  );
  assertEqual(getTournamentChampion(tournamentId), winners[0], 'champion unchanged after rejection');
});

test('bracket: a started downstream match blocks correction', () => {
  const { tournamentId } = setupTournament(DG, 4);
  const semis = getTournamentMatches(tournamentId).filter((m) => m.round_no === 1);
  const semi = semis[0];
  recordMatchResult({ matchId: semi.id, winnerPlayerId: getMatchParticipants(semi.id)[0].player_id! });
  const next = getMatch(semi.next_match_id!)!;
  setMatchStatus(next.id, 'scheduled');
  assertEqual(
    codeOf(() =>
      correctMatchResult({
        matchId: semi.id,
        correctedWinnerPlayerId: getMatchParticipants(semi.id)[1].player_id!,
        reason: 'started',
      })
    ),
    'downstream_in_progress',
    'scheduled downstream blocks correction'
  );
});

test('audit trail records previous/corrected result, reason and actor', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });
  correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'audited reason', actorId: ADMIN });
  const row = getDb()
    .prepare('SELECT * FROM match_result_corrections WHERE match_id = ?')
    .get(matchId) as any;
  assertEqual(row.previous_winner_player_id, a, 'previous winner');
  assertEqual(row.corrected_winner_player_id, b, 'corrected winner');
  assertEqual(row.previous_result, 'win', 'previous result');
  assertEqual(row.corrected_result, 'win', 'corrected result');
  assertEqual(row.reason, 'audited reason', 'reason');
  assertEqual(row.actor_id, ADMIN, 'actor');
  assertEqual(row.game_id, DG, 'game');
});

test('atomicity: a forced failure rolls back the entire correction', () => {
  const { tournamentId } = setupTournament(DG, 2);
  const { matchId, a, b } = finalPair(tournamentId);
  recordMatchResult({ matchId, winnerPlayerId: a });

  const snapshot = JSON.stringify({
    match: getMatch(matchId),
    lp: getDb().prepare('SELECT * FROM lp_transactions ORDER BY id').all(),
    elo: getDb().prepare('SELECT * FROM elo_transactions ORDER BY id').all(),
    profiles: getDb().prepare('SELECT * FROM competitive_profiles ORDER BY player_id, game_id').all(),
    audit: getDb().prepare('SELECT * FROM match_result_corrections').all(),
    parts: getDb().prepare('SELECT * FROM tournament_match_participants ORDER BY match_id, slot').all(),
  });

  getDb().exec(
    "CREATE TRIGGER corr_abort BEFORE INSERT ON match_result_corrections BEGIN SELECT RAISE(ABORT, 'boom'); END;"
  );
  try {
    assertThrows(
      () => correctMatchResult({ matchId, correctedWinnerPlayerId: b, reason: 'will roll back' }),
      'expected failure'
    );
  } finally {
    getDb().exec('DROP TRIGGER IF EXISTS corr_abort');
  }

  const after = JSON.stringify({
    match: getMatch(matchId),
    lp: getDb().prepare('SELECT * FROM lp_transactions ORDER BY id').all(),
    elo: getDb().prepare('SELECT * FROM elo_transactions ORDER BY id').all(),
    profiles: getDb().prepare('SELECT * FROM competitive_profiles ORDER BY player_id, game_id').all(),
    audit: getDb().prepare('SELECT * FROM match_result_corrections').all(),
    parts: getDb().prepare('SELECT * FROM tournament_match_participants ORDER BY match_id, slot').all(),
  });
  assertEqual(after, snapshot, 'full rollback');
  assertEqual(getMatch(matchId)!.winner_player_id, a, 'winner unchanged after rollback');
});

test('cross-game isolation: correcting a Dueling Grounds match never touches Rocket League', () => {
  counter += 1;
  const dgId = `iso-dg-${counter}`;
  const rlId = `iso-rl-${counter}`;
  seedTournament({ id: dgId, gameId: DG, status: 'open', createdBy: ADMIN });
  seedTournament({ id: rlId, gameId: RL, status: 'open', createdBy: ADMIN });
  const players = [`iso-a-${counter}`, `iso-b-${counter}`];
  for (const pid of players) {
    seedPlayer(pid, pid);
    seedTournamentParticipant(dgId, pid);
    seedTournamentParticipant(rlId, pid);
  }
  generateBracket(dgId);
  generateBracket(rlId);
  recordMatchResult({ matchId: getTournamentMatches(dgId)[0].id, winnerPlayerId: players[0] });
  recordMatchResult({ matchId: getTournamentMatches(rlId)[0].id, winnerPlayerId: players[1] });

  const rlBefore = JSON.stringify(getProfile(players[0], RL)) + JSON.stringify(getProfile(players[1], RL));
  correctMatchResult({
    matchId: getTournamentMatches(dgId)[0].id,
    correctedWinnerPlayerId: players[1],
    reason: 'flip DG only',
  });
  const rlAfter = JSON.stringify(getProfile(players[0], RL)) + JSON.stringify(getProfile(players[1], RL));
  assertEqual(rlAfter, rlBefore, 'RL profiles untouched by DG correction');
  assertEqual(getProfile(players[1], DG)!.wins, 1, 'DG corrected winner has the win');
});

cleanupTestDb();
summarize('MatchCorrectionService');
