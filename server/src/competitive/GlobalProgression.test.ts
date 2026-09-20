/**
 * Phase 2.z — Global Competitive Progression integration tests.
 *
 * Covers the XP lifecycle (award, idempotency, correction/reversal, rebuild),
 * cross-game aggregation, global matches/wins, historical backfill and the
 * profile DTO — all against the REAL services/DB (isolated test database).
 *
 * Run: `ts-node src/competitive/GlobalProgression.test.ts`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  seedGame,
  seedPlayer,
  seedTournament,
  seedTournamentParticipant,
  seedUser,
} from './competitiveTestSeed';
import { generateBracket } from './BracketService';
import { getTournamentMatches, recordMatchResult } from './TournamentMatchService';
import { correctMatchResult } from './MatchCorrectionService';
import { getProfile } from './CompetitiveProfileService';
import {
  backfillCompetitiveXp,
  deriveTotalXp,
  getCompetitiveProgressionDto,
  getGlobalCompetitiveStats,
  getTotalXp,
  rebuildProgression,
} from './GlobalProgressionService';
import { assertEqual, assertTrue, summarize, test } from './testHarness';

const DG = 'gp-game-dg';
const RL = 'gp-game-rl';
const ADMIN = 'gp-admin';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');
seedUser(ADMIN);
seedGame(DG, 'dueling_ground');
seedGame(RL, 'rocket_league');

function wipe(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM competitive_progressions').run();
    db.prepare('DELETE FROM competitive_xp_transactions').run();
    db.prepare('DELETE FROM match_result_corrections').run();
    db.prepare('DELETE FROM tournament_match_participants').run();
    db.prepare('DELETE FROM tournament_matches').run();
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
    db.prepare('DELETE FROM lp_transactions').run();
    db.prepare('DELETE FROM elo_transactions').run();
    db.prepare('DELETE FROM competitive_profiles').run();
  })();
}

let counter = 0;

function setup(playerCount = 2, gameId = DG): string[] {
  counter += 1;
  const id = `gp-t-${counter}`;
  seedTournament({ id, gameId, status: 'open', createdBy: ADMIN });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `${id}-p${i + 1}`;
    seedPlayer(pid, `Player ${i + 1}`);
    seedTournamentParticipant(id, pid);
    players.push(pid);
  }
  generateBracket(id);
  return players;
}

function xpRows(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM competitive_xp_transactions').get() as { n: number }).n;
}

console.log('=== GlobalProgression ===');

test('1 — completed match awards 50 XP (win) / 25 XP (loss) + global stats', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });

  assertEqual(getTotalXp(players[0]), 50, 'winner XP');
  assertEqual(getTotalXp(players[1]), 25, 'loser XP');

  const stats = getGlobalCompetitiveStats(players[0]);
  assertEqual(stats.matches, 1, 'global matches');
  assertEqual(stats.wins, 1, 'global wins');

  const dto = getCompetitiveProgressionDto(players[0]);
  assertEqual(dto.level, 1, 'level 1');
  assertEqual(dto.progress.pct, 50, '50% toward level 2');
});

test('2 — repeated result submission is idempotent (no double XP)', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  const xp = getTotalXp(players[0]);
  const rows = xpRows();

  const replay = recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  assertTrue(replay.alreadyProcessed, 'replay flagged');
  assertEqual(getTotalXp(players[0]), xp, 'XP unchanged');
  assertEqual(xpRows(), rows, 'no extra ledger rows');
});

test('3 — correction win→loss reverses then reapplies XP', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  assertEqual(getTotalXp(players[0]), 50, 'pre A');
  assertEqual(getTotalXp(players[1]), 25, 'pre B');

  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: players[1], reason: 'flip' });

  assertEqual(getTotalXp(players[0]), 25, 'A net loss XP');
  assertEqual(getTotalXp(players[1]), 50, 'B net win XP');
  assertEqual(deriveTotalXp(players[0]), 25, 'ledger net matches');
});

test('4 — correction win→draw then draw→win', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });

  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: null, reason: 'draw', idempotencyKey: 'gp:draw' });
  assertEqual(getTotalXp(players[0]), 35, 'A draw XP');
  assertEqual(getTotalXp(players[1]), 35, 'B draw XP');

  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: players[1], reason: 'B wins', idempotencyKey: 'gp:bwin' });
  assertEqual(getTotalXp(players[0]), 25, 'A loss XP');
  assertEqual(getTotalXp(players[1]), 50, 'B win XP');
});

test('5 — repeated correction is idempotent', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: players[1], reason: 'flip', idempotencyKey: 'gp:corr' });
  const rows = xpRows();
  const xp = getTotalXp(players[0]);

  const again = correctMatchResult({
    matchId: match.id,
    correctedWinnerPlayerId: players[1],
    reason: 'flip',
    idempotencyKey: 'gp:corr',
  });
  assertTrue(again.alreadyProcessed, 'flagged');
  assertEqual(xpRows(), rows, 'no extra rows');
  assertEqual(getTotalXp(players[0]), xp, 'XP unchanged');
});

test('6 — original XP award row is immutable across correction', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });
  const key = `match:${match.id}:${players[0]}:xp`;
  const before = getDb().prepare('SELECT * FROM competitive_xp_transactions WHERE idempotency_key = ?').get(key);
  assertEqual((before as { amount: number }).amount, 50, 'original +50');

  correctMatchResult({ matchId: match.id, correctedWinnerPlayerId: players[1], reason: 'flip' });
  const after = getDb().prepare('SELECT * FROM competitive_xp_transactions WHERE idempotency_key = ?').get(key);
  assertEqual(JSON.stringify(after), JSON.stringify(before), 'original row untouched');
});

test('7 — materialized total rebuilds deterministically from the ledger', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });

  getDb().prepare('UPDATE competitive_progressions SET total_xp = 9999 WHERE player_id = ?').run(players[0]);
  const rebuilt = rebuildProgression(players[0]);
  assertEqual(rebuilt.after, deriveTotalXp(players[0]), 'rebuilt == ledger net');
  assertEqual(getTotalXp(players[0]), 50, 'restored');
});

test('8 — XP aggregates across games; LP/Elo stay per-game', () => {
  wipe();
  const p = ['gp-aggregate-a', 'gp-aggregate-b'];
  seedPlayer(p[0]);
  seedPlayer(p[1]);

  for (const gameId of [DG, RL]) {
    const tid = `gp-global-${gameId}`;
    seedTournament({ id: tid, gameId, status: 'open', createdBy: ADMIN });
    seedTournamentParticipant(tid, p[0]);
    seedTournamentParticipant(tid, p[1]);
    generateBracket(tid);
    const match = getTournamentMatches(tid)[0];
    recordMatchResult({ matchId: match.id, winnerPlayerId: p[0] });
  }

  assertEqual(getTotalXp(p[0]), 100, 'global XP = 50 + 50');
  assertEqual(getTotalXp(p[1]), 50, 'global XP = 25 + 25');
  assertEqual(getProfile(p[0], DG)!.lp, 25, 'DG LP');
  assertEqual(getProfile(p[0], RL)!.lp, 25, 'RL LP');
  assertTrue(getProfile(p[1], DG)!.losses === 1 && getProfile(p[1], RL)!.losses === 1, 'per-game records');

  const stats = getGlobalCompetitiveStats(p[0]);
  assertEqual(stats.matches, 2, 'two global matches');
  assertEqual(stats.wins, 2, 'two global wins');
  assertEqual(getCompetitiveProgressionDto(p[0]).level, 2, '100 XP = level 2');
});

test('9 — backfill awards completed matches and is idempotent', () => {
  wipe();
  const players = setup();
  const match = getTournamentMatches(`gp-t-${counter}`)[0];
  recordMatchResult({ matchId: match.id, winnerPlayerId: players[0] });

  // Simulate pre-XP history: strip XP artifacts (matches stay completed).
  getDb().prepare('DELETE FROM competitive_xp_transactions').run();
  getDb().prepare('DELETE FROM competitive_progressions').run();
  assertEqual(getTotalXp(players[0]), 0, 'no XP pre-backfill');

  const first = backfillCompetitiveXp();
  assertTrue(first.awardsInserted >= 2, 'awards inserted');
  assertEqual(getTotalXp(players[0]), 50, 'winner backfilled');
  assertEqual(getTotalXp(players[1]), 25, 'loser backfilled');

  const second = backfillCompetitiveXp();
  assertEqual(second.awardsInserted, 0, 'rerun inserts nothing');
  assertTrue(second.awardsSkipped >= 2, 'rerun skips');
});

test('10 — backfill ignores pending/cancelled/incomplete matches', () => {
  wipe();
  setup(); // bracket generated, no result recorded → match is 'pending'
  const res = backfillCompetitiveXp();
  assertEqual(res.matchesScanned, 0, 'no completed matches');
  assertEqual(res.awardsInserted, 0, 'no awards');
  assertEqual(xpRows(), 0, 'no ledger rows');
});

cleanupTestDb();
summarize('GlobalProgression');
