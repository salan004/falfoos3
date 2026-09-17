/**
 * Phase 1C — rank integrity, cross-view consistency and lazy-profile tests.
 *
 * Verifies:
 * - the base competitive rank is Bronze (computeRank(0).rankKey === 'bronze_3');
 * - tournament registration never creates a profile / LP / Elo / W-L;
 * - the targeted roster carries competitive rank/LP/Elo independent of the
 *   leaderboard's top-N limit, and the base rank for unranked participants;
 * - participant counts agree across list / detail / roster / stored counter;
 * - the same player/game resolves to identical LP/Elo/rank across consumers.
 *
 * Isolated temp DB only (via ./testDb). Run: `npm -w server run test`.
 */

import './testDb';
import { getDb } from '../db/db';
import { assertEqual, assertNull, assertTrue, summarize, test } from './testHarness';
import { cleanCompetitive, cleanTournaments, seedGame, seedPlayer, seedUser } from './competitiveTestSeed';
import { computeRank } from './ranks';
import { createTournament, getTournamentWithGameInfo } from '../games/TournamentService';
import {
  cancelParticipant,
  getParticipantCount,
  registerParticipantTransactional,
} from '../games/ParticipantService';
import { generateBracket } from './BracketService';
import { recordMatchResult } from './TournamentMatchService';
import { getGameLeaderboard, getParticipantsDto, getTournamentSummary } from './CompetitiveQueryService';

const GAME = 'p1c-game';
const ADMIN = 'p1c-admin';
const PA = 'p1c-pA';
const PB = 'p1c-pB';
const PC = 'p1c-pC';

function count(table: string): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}
function openTournament(name: string, players: string[]): string {
  const id = createTournament({ game_id: GAME, name_ar: name, status: 'open' }, ADMIN).id;
  for (const p of players) {
    const r = registerParticipantTransactional(id, p, 'admin', null);
    if (!r.success) throw new Error(`registration failed: ${r.error}`);
  }
  return id;
}

console.log('=== Rank Integrity (Phase 1C) ===');

cleanCompetitive();
cleanTournaments();
seedGame(GAME, 'p1c-game', 'P1C Game');
seedUser(ADMIN, 'admin');
[PA, PB, PC].forEach((p, i) => seedPlayer(p, `P1C_${'ABC'[i]}`));

test('base competitive rank is Bronze (computeRank(0))', () => {
  const base = computeRank(0);
  assertEqual(base.rankKey, 'bronze_3', 'base rank key');
  assertEqual(base.tierKey, 'bronze', 'base tier');
  assertEqual(base.levelIndex, 1, 'base level');
});

test('registration alone creates no profile / LP / Elo / stats (lazy)', () => {
  const before = { p: count('competitive_profiles'), lp: count('lp_transactions'), elo: count('elo_transactions') };
  const tid = openTournament('P1C Lazy', [PA, PB, PC]);
  assertEqual(count('competitive_profiles'), before.p, 'no profile created');
  assertEqual(count('lp_transactions'), before.lp, 'no LP transaction');
  assertEqual(count('elo_transactions'), before.elo, 'no Elo transaction');

  const roster = getParticipantsDto(tid);
  assertEqual(roster.length, 3, 'roster size');
  for (const entry of roster) {
    assertTrue(entry.unranked, 'participant is unranked');
    assertNull(entry.lp, 'no LP fabricated');
    assertNull(entry.elo, 'no Elo fabricated');
    assertEqual(entry.rank.rankKey, 'bronze_3', 'initial rank is Bronze 3');
  }
});

test('participant count is consistent across list / detail / roster / counter', () => {
  const tid = openTournament('P1C Counts', [PA, PB, PC]);
  cancelParticipant(tid, PC); // sets status=cancelled and decrements the counter

  assertEqual(getTournamentWithGameInfo(tid)!.participant_count, 2, 'list count');
  assertEqual(getTournamentSummary(tid)!.participantCount, 2, 'detail summary count');
  assertEqual(getParticipantsDto(tid).length, 2, 'roster count');
  assertEqual(getParticipantCount(tid), 2, 'stored counter');
});

test('roster carries competitive rank/LP/Elo independent of the leaderboard limit', () => {
  const tid = openTournament('P1C Ranked', [PA, PB]);
  generateBracket(tid);
  const match = getDb()
    .prepare("SELECT id FROM tournament_matches WHERE tournament_id = ? AND round_no = 1")
    .get(tid) as { id: string };
  const parts = getDb()
    .prepare('SELECT player_id, slot FROM tournament_match_participants WHERE match_id = ? ORDER BY slot')
    .all(match.id) as { player_id: string; slot: number }[];
  const winnerId = parts[0].player_id;
  const loserId = parts[1].player_id;
  recordMatchResult({ matchId: match.id, winnerPlayerId: winnerId });

  const roster = getParticipantsDto(tid);
  const winner = roster.find((r) => r.playerId === winnerId)!;
  const loser = roster.find((r) => r.playerId === loserId)!;

  assertEqual(winner.unranked, false, 'winner ranked');
  assertEqual(winner.lp, 25, 'winner LP');
  assertEqual(winner.elo, 1216, 'winner Elo');
  assertEqual(winner.rank.rankKey, computeRank(25).rankKey, 'winner rank derived');
  assertEqual(loser.lp, 0, 'loser LP floored at 0');
  assertEqual(loser.rank.rankKey, 'bronze_3', 'loser rank');

  // Cross-view: same player/game must agree with the game leaderboard.
  const board = getGameLeaderboard(GAME)!;
  const boardWinner = board.players.find((p) => p.playerId === winnerId)!;
  assertEqual(boardWinner.lp, winner.lp, 'leaderboard LP == roster LP');
  assertEqual(boardWinner.elo, winner.elo, 'leaderboard Elo == roster Elo');
  assertEqual(boardWinner.rank.rankKey, winner.rank.rankKey, 'leaderboard rank == roster rank');
});

summarize('RankIntegrity');
