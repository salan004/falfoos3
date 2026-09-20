/**
 * Phase 2.y — Stream Games ↔ Competitive progression boundary tests.
 *
 * Proves that the recreational Stream Game engine (GameManager + BaseGame) can
 * never create or mutate competitive state, while Stream Game history and the
 * recreational profile blocks remain intact and backward compatible.
 *
 * Run: `ts-node src/games/streamGameBoundary.test.ts` (wired into `npm run test`).
 */

import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import { GameManager } from '../core/GameManager';
import { BaseGame, type ChatMessage } from '../core/BaseGame';
import { classifyGame, isRecreationalStreamGame } from './gameKinds';
import { buildProfile } from '../routes/playerRoutes';
import { getProfile, applyResultStats } from '../competitive/CompetitiveProfileService';
import { applyLpResult } from '../competitive/LpService';
import { applyEloResult } from '../competitive/EloService';
import { computeRank } from '../competitive/ranks';
import { seedGame, seedPlayer } from '../competitive/competitiveTestSeed';
import { assertEqual, assertTrue, summarize, test } from '../competitive/testHarness';

const P = 'boundary-player';
const G1 = 'boundary-game-dg';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

/** Minimal recreational game used to drive the REAL GameManager pipeline. */
class StubStreamGame extends BaseGame {
  readonly config = { id: 'trivia', name: 'Stub Trivia', description: 'boundary test' };
  state: Record<string, unknown> = {};
  getPublicState(): Record<string, unknown> {
    return {};
  }
  init(): void {
    this.newSessionId();
  }
  start(): void {}
  stop(): void {}
  reset(): void {}
  handleChatMessage(_msg: ChatMessage): void {}
  handleAdminCommand(): void {}
  /** Emits the standard join event (participation history). */
  join(playerId: string, name: string): void {
    this.broadcast({
      type: 'game:playerJoined',
      payload: { gameId: this.config.id, playerId, displayName: name },
      timestamp: Date.now(),
    });
  }
  /** Emits the standard finish event (winner history + achievements). */
  finish(winnerIds: string[], scope: 'match' | 'round'): void {
    this.announceWinners(winnerIds, scope);
  }
}

function count(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function countWhere(table: string, playerId: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player_id = ?`).get(playerId) as { n: number }).n;
}

function wipeAll(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM competitive_progressions').run();
    db.prepare('DELETE FROM competitive_xp_transactions').run();
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

/** Drives a complete recreational Stream Game activation. */
function playStreamGame(): void {
  const gm = new GameManager();
  const game = new StubStreamGame();
  gm.registerGame(game);
  gm.switchGame('trivia');
  game.join(P, 'Boundary Player');
  gm.updateScore(P, 'Boundary Player', 100, undefined, 'trivia:correct');
  game.finish([P], 'match');
}

console.log('=== StreamGameBoundary ===');

test('1 — game-kind classification is explicit (no in-memory/DB guessing)', () => {
  wipeAll();
  seedGame(G1, 'dueling_ground');
  assertEqual(isRecreationalStreamGame('trivia'), true, 'trivia is recreational');
  assertEqual(isRecreationalStreamGame('mafia'), true, 'mafia is recreational');
  assertEqual(isRecreationalStreamGame(G1), false, 'competitive game is not recreational');
  assertEqual(classifyGame('trivia'), 'recreational', 'trivia classified recreational');
  assertEqual(classifyGame('hide_and_seek'), 'recreational', 'hide_and_seek classified recreational');
  assertEqual(classifyGame(G1), 'competitive', 'catalog game classified competitive');
  assertEqual(classifyGame('not-a-game'), 'unknown', 'unknown id');
});

test('2 — Stream Game history remains intact after separation', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();

  assertTrue(countWhere('score_events', P) >= 1, 'score event recorded');
  assertTrue(countWhere('participations', P) >= 1, 'participation recorded');
  assertTrue(countWhere('match_winners', P) >= 1, 'winner recorded');
  assertTrue(count('matches') >= 1, 'match row recorded');
});

test('3 — Stream Game creates NO competitive profile', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();
  assertEqual(count('competitive_profiles'), 0, 'no competitive profile created');
});

test('3b — Stream Game creates NO global competitive XP or progression', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();
  assertEqual(count('competitive_xp_transactions'), 0, 'no competitive XP ledger rows');
  assertEqual(count('competitive_progressions'), 0, 'no competitive progression rows');
});

test('4 — Stream Game creates NO LP transaction', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();
  assertEqual(count('lp_transactions'), 0, 'no LP transaction created');
});

test('5 — Stream Game creates NO Elo transaction', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();
  assertEqual(count('elo_transactions'), 0, 'no Elo transaction created');
});

test('6 — Stream Game does not change an existing competitive profile or rank', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  seedGame(G1, 'dueling_ground');
  applyResultStats(P, G1, 'win');
  applyLpResult({ playerId: P, gameId: G1, result: 'win', idempotencyKey: 'boundary:lp' });
  applyEloResult({ playerId: P, gameId: G1, opponentRating: 1200, result: 'win', idempotencyKey: 'boundary:elo' });

  const before = getProfile(P, G1)!;
  const rankBefore = computeRank(before.lp).rankKey;
  const lpRowsBefore = count('lp_transactions');
  const eloRowsBefore = count('elo_transactions');

  playStreamGame();

  const after = getProfile(P, G1)!;
  assertEqual(after.lp, before.lp, 'LP unchanged');
  assertEqual(after.elo, before.elo, 'Elo unchanged');
  assertEqual(after.wins, before.wins, 'wins unchanged');
  assertEqual(after.losses, before.losses, 'losses unchanged');
  assertEqual(after.matches_played, before.matches_played, 'matches unchanged');
  assertEqual(computeRank(after.lp).rankKey, rankBefore, 'rank unchanged');
  assertEqual(count('lp_transactions'), lpRowsBefore, 'no new LP rows');
  assertEqual(count('elo_transactions'), eloRowsBefore, 'no new Elo rows');
  assertEqual(count('competitive_profiles'), 1, 'still exactly one profile');
});

test('7 — Stream achievements remain recreational (never competitive)', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();
  // Achievements are stored in the recreational table only.
  assertTrue(countWhere('player_achievements', P) >= 1, 'recreational achievement awarded');
  assertEqual(count('competitive_profiles'), 0, 'no competitive profile');
  assertEqual(count('lp_transactions'), 0, 'no LP');
  assertEqual(count('elo_transactions'), 0, 'no Elo');
});

test('8 — profile API separates recreational vs competitive ownership', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();

  const profile = buildProfile(P)!;
  assertTrue(!!profile, 'profile built');
  assertEqual(profile.recreational.source, 'stream_games', 'recreational owner');
  assertTrue(profile.recreational.totals.matchesPlayed >= 1, 'recreational matches');
  assertTrue(profile.recreational.totals.totalPoints >= 100, 'recreational points');
  assertTrue(profile.recreational.achievements.length >= 1, 'recreational achievements');
  assertEqual(profile.competitive.source, 'competitive_tournaments', 'competitive owner');
  assertEqual(profile.competitive.status, 'active', 'competitive active');
  assertEqual(profile.competitive.xp, 0, 'stream games grant no competitive XP');
  assertEqual(profile.competitive.level, 1, 'competitive level stays 1');
  assertEqual(profile.competitive.matches, 0, 'no competitive matches');
  assertEqual(profile.competitive.wins, 0, 'no competitive wins');
});

test('9 — existing competitive data is unchanged by Stream activity', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  seedGame(G1, 'dueling_ground');
  applyResultStats(P, G1, 'loss');
  applyLpResult({ playerId: P, gameId: G1, result: 'loss', idempotencyKey: 'boundary9:lp' });
  applyEloResult({ playerId: P, gameId: G1, opponentRating: 1300, result: 'loss', idempotencyKey: 'boundary9:elo' });
  const before = getProfile(P, G1)!;

  playStreamGame();

  const after = getProfile(P, G1)!;
  assertEqual(JSON.stringify(after), JSON.stringify(before), 'competitive profile byte-identical');
  assertEqual(countWhere('competitive_profiles', P), 1, 'one competitive profile');
});

test('10 — profile compatibility: legacy fields equal the recreational block', () => {
  wipeAll();
  seedPlayer(P, 'Boundary Player');
  playStreamGame();

  const profile = buildProfile(P)!;
  assertEqual(JSON.stringify(profile.totals), JSON.stringify(profile.recreational.totals), 'totals alias');
  assertEqual(JSON.stringify(profile.level), JSON.stringify(profile.recreational.level), 'level alias');
  assertEqual(JSON.stringify(profile.achievements), JSON.stringify(profile.recreational.achievements), 'achievements alias');
  assertEqual(profile.recentMatches.length, profile.recreational.recentMatches.length, 'history alias');
});

cleanupTestDb();
summarize('StreamGameBoundary');
