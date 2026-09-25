/**
 * Phase 4D — public tournament/competitive API tests.
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
import { getMatchParticipants, getTournamentMatches, recordMatchResult } from './TournamentMatchService';
import { startTestApi, request, type TestApi } from './apiTestHarness';
import { assertEqual, assertTrue, summarize, testAsync } from './testHarness';

const ADMIN = 'api-admin';
const DG = 'api-game-dg';
const RL = 'api-game-rl';

let api: TestApi;

function data(path: string) {
  return request<Record<string, any>>(api.baseUrl, path);
}

function setupTournament(id: string, playerCount: number): string[] {
  seedTournament({ id, gameId: DG, status: 'open', createdBy: ADMIN });
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

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');
  seedUser(ADMIN);
  seedGame(DG, 'dueling_grounds');
  seedGame(RL, 'rocket_league');
  cleanCompetitive();
  cleanTournaments();

  console.log('=== TournamentApi (public) ===');

  const PENDING_ID = 'api-pub-pending';
  const pendingPlayers = setupTournament(PENDING_ID, 4);
  // Complete one semifinal to create a completed match + competitive effects.
  const semis = getTournamentMatches(PENDING_ID).filter((m) => m.round_no === 1);
  const semiWinner = getMatchParticipants(semis[0].id)[0].player_id!;
  recordMatchResult({ matchId: semis[0].id, winnerPlayerId: semiWinner });

  const DONE_ID = 'api-pub-done';
  const donePlayers = setupTournament(DONE_ID, 2);
  const finalMatch = getTournamentMatches(DONE_ID)[0];
  const champion = donePlayers[0];
  recordMatchResult({ matchId: finalMatch.id, winnerPlayerId: champion });

  api = await startTestApi();

  try {
    await testAsync('GET /api/tournaments/:id/summary returns safe public fields', async () => {
      const res = await data(`/api/tournaments/${PENDING_ID}/summary`);
      assertEqual(res.status, 200, 'status');
      const t = res.body.tournament;
      assertEqual(t.id, PENDING_ID, 'id');
      assertEqual(t.status, 'active', 'status active');
      assertEqual(t.bracketGenerated, true, 'bracket generated');
      assertEqual(t.totalRounds, 2, 'total rounds');
      assertEqual(t.participantCount, 4, 'participant count');
      assertEqual(t.matchCount, 3, 'match count');
      assertEqual(t.completedMatchCount, 1, 'completed matches');
      assertEqual(t.championPlayerId, null, 'no champion yet');
      assertTrue(!('created_by' in t), 'internal fields not exposed');
    });

    await testAsync('GET bracket preserves the graph, ordering and round names', async () => {
      const res = await data(`/api/tournaments/${PENDING_ID}/bracket`);
      assertEqual(res.status, 200, 'status');
      const bracket = res.body.bracket;
      assertEqual(bracket.totalRounds, 2, 'rounds');
      assertEqual(bracket.rounds.map((r: any) => r.matches.length).join(','), '2,1', 'matches per round');
      assertEqual(bracket.rounds[0].nameEn, 'Semi Final', 'round 1 name');
      assertEqual(bracket.rounds[1].nameEn, 'Final', 'final name');
      const semi = bracket.rounds[0].matches[0];
      const finalId = bracket.rounds[1].matches[0].id;
      assertTrue(semi.nextMatchId === finalId, 'semi points at final');
      assertTrue(semi.nextMatchSlot === 1 || semi.nextMatchSlot === 2, 'next slot 1/2');
      assertEqual(semi.players.length, 2, 'two players');
    });

    await testAsync('GET matches lists every match in round/slot order', async () => {
      const res = await data(`/api/tournaments/${PENDING_ID}/matches`);
      assertEqual(res.status, 200, 'status');
      const matches = res.body.matches as any[];
      assertEqual(matches.length, 3, 'three matches');
      assertEqual(matches.map((m) => `${m.roundNo}:${m.slotNo}`).join(','), '1:1,1:2,2:1', 'deterministic ordering');
    });

    await testAsync('GET match detail includes tournament and graph info', async () => {
      const final = getTournamentMatches(PENDING_ID).find((m) => m.round_no === 2)!;
      const res = await data(`/api/matches/${final.id}`);
      assertEqual(res.status, 200, 'status');
      assertEqual(res.body.match.id, final.id, 'match id');
      assertEqual(res.body.match.nextMatchId, null, 'final has no next');
      assertEqual(res.body.tournament.id, PENDING_ID, 'tournament id');
      assertEqual(res.body.tournament.gameId, DG, 'game id');
    });

    await testAsync('GET roster exposes seed and elimination state', async () => {
      const res = await data(`/api/tournaments/${PENDING_ID}/roster`);
      assertEqual(res.status, 200, 'status');
      const participants = res.body.participants as any[];
      assertEqual(participants.length, 4, 'four participants');
      const seeds = participants.map((p) => p.seed).filter((s) => s !== null).sort();
      assertEqual(JSON.stringify(seeds), JSON.stringify([1, 2, 3, 4]), 'seeds present');
      const winnerEntry = participants.find((p) => p.playerId === semiWinner)!;
      assertEqual(winnerEntry.advanced, true, 'winner advanced');
      assertEqual(winnerEntry.eliminated, false, 'winner not eliminated');
    });

    await testAsync('GET player tournament state answers registration/advancement', async () => {
      const winner = await data(`/api/tournaments/${PENDING_ID}/players/${semiWinner}`);
      assertEqual(winner.status, 200, 'status');
      assertEqual(winner.body.state.registered, true, 'registered');
      assertEqual(winner.body.state.wins, 1, 'winner has one win');
      assertEqual(winner.body.state.advanced, true, 'winner is in the final');
      assertEqual(winner.body.state.eliminated, false, 'winner not eliminated');

      const semiLoser = getMatchParticipants(semis[0].id).find((p) => p.player_id !== semiWinner)!.player_id;
      const loserRes = await data(`/api/tournaments/${PENDING_ID}/players/${semiLoser}`);
      assertEqual(loserRes.body.state.eliminated, true, 'semi loser eliminated');
      assertEqual(loserRes.body.state.losses, 1, 'semi loser has one loss');
    });

    await testAsync('GET player competitive profile derives rank from LP', async () => {
      const res = await data(`/api/players/${semiWinner}/competitive`);
      assertEqual(res.status, 200, 'status');
      const profile = (res.body.profiles as any[]).find((p) => p.gameId === DG);
      assertTrue(!!profile, 'profile present');
      assertEqual(profile.lp, 25, 'win LP');
      assertEqual(profile.elo, 1216, 'win Elo');
      assertEqual(profile.rank.rankKey, 'bronze_3', 'derived rank');
    });

    await testAsync('GET player competitive?allGames=1 lists every active game (ranked + unranked)', async () => {
      const res = await data(`/api/players/${semiWinner}/competitive?allGames=1`);
      assertEqual(res.status, 200, 'status');
      const profiles = res.body.profiles as any[];
      // Exactly the two active games seeded for this suite: DG and RL.
      assertEqual(profiles.length, 2, 'one entry per active game');

      const dg = profiles.find((p) => p.gameId === DG)!;
      assertTrue(!!dg, 'DG entry present');
      assertEqual(dg.unranked, false, 'DG is ranked');
      assertEqual(dg.lp, 25, 'DG LP');
      assertEqual(dg.elo, 1216, 'DG Elo');
      assertEqual(dg.rank.rankKey, 'bronze_3', 'DG rank server-derived');

      const rl = profiles.find((p) => p.gameId === RL)!;
      assertTrue(!!rl, 'RL entry present');
      assertEqual(rl.unranked, true, 'RL is unranked');
      assertEqual(rl.lp, 0, 'RL default LP');
      assertEqual(rl.elo, 1200, 'RL default Elo');
      assertEqual(rl.matchesPlayed, 0, 'RL default matches');
      assertEqual(rl.rank.rankKey, 'bronze_3', 'RL base rank server-derived');

      // The all-games projection must NOT create a competitive profile row.
      const legacy = await data(`/api/players/${semiWinner}/competitive`);
      assertEqual((legacy.body.profiles as any[]).length, 1, 'default projection still one row');
    });

    await testAsync('GET game competitive leaderboard is ordered by LP and isolated by game', async () => {
      const res = await data(`/api/games/${DG}/competitive`);
      assertEqual(res.status, 200, 'status');
      const board = res.body.leaderboard;
      assertEqual(board.gameId, DG, 'game id');
      assertTrue(board.players.length >= 1, 'has players');
      const entry = board.players.find((p: any) => p.playerId === semiWinner);
      assertTrue(!!entry, 'semi winner listed');
      assertEqual(entry.lp, 25, 'lp');
      assertEqual(entry.rank.rankKey, 'bronze_3', 'rank derived from LP');
      for (let i = 1; i < board.players.length; i++) {
        assertTrue(board.players[i - 1].lp >= board.players[i].lp, 'ordered by lp desc');
      }
      assertEqual((await data('/api/games/no-such-game/competitive')).status, 404, 'unknown game');
      assertEqual((await data(`/api/games/${DG}/competitive?limit=1`)).body.leaderboard.players.length, 1, 'limit respected');

      // Game isolation: a different game never sees this game's competitive data.
      const other = await data(`/api/games/${RL}/competitive`);
      assertEqual(other.status, 200, 'other game status');
      assertEqual(other.body.leaderboard.gameId, RL, 'other game id');
      assertEqual(other.body.leaderboard.players.length, 0, 'no cross-game leakage');
    });

    await testAsync('GET player tournaments lists states', async () => {
      const res = await data(`/api/players/${semiWinner}/tournaments`);
      assertEqual(res.status, 200, 'status');
      const state = (res.body.states as any[]).find((s) => s.tournamentId === PENDING_ID);
      assertTrue(!!state, 'state present');
      assertEqual(state.registered, true, 'registered');
    });

    await testAsync('a completed tournament exposes its champion', async () => {
      const res = await data(`/api/tournaments/${DONE_ID}/summary`);
      assertEqual(res.body.tournament.status, 'completed', 'completed status');
      assertEqual(res.body.tournament.championPlayerId, champion, 'champion');
      const bracket = await data(`/api/tournaments/${DONE_ID}/bracket`);
      assertEqual(bracket.body.bracket.rounds[0].matches[0].status, 'completed', 'final completed');
      assertEqual(bracket.body.bracket.rounds[0].matches[0].winnerPlayerId, champion, 'final winner');
    });

    await testAsync('full mount: the game catalog is reachable and not shadowed', async () => {
      const list = await data('/api/games');
      assertEqual(list.status, 200, 'games list status');
      assertTrue(Array.isArray(list.body.games), 'games is an array');
      const ids = (list.body.games as any[]).map((g) => g.id).sort();
      assertTrue(ids.includes(DG) && ids.includes(RL), 'both seeded games are listed');

      const one = await data(`/api/games/${DG}`);
      assertEqual(one.status, 200, 'game detail status');
      assertEqual(one.body.game.id, DG, 'game detail id');
      assertEqual(one.body.game.slug, 'dueling_grounds', 'game detail slug');

      const gameTournaments = await data(`/api/games/${DG}/tournaments`);
      assertEqual(gameTournaments.status, 200, 'game tournaments status');
      assertTrue(Array.isArray(gameTournaments.body.tournaments), 'game tournaments array');

      // The literal `/api/tournaments` route must win over any `/:gameId` route.
      const all = await data('/api/tournaments');
      assertEqual(all.status, 200, 'tournaments list status');
      assertTrue(Array.isArray(all.body.tournaments), 'tournaments is an array');
    });

    await testAsync('unknown resources return 404 and bad ids return 400', async () => {
      assertEqual((await data('/api/tournaments/does-not-exist/summary')).status, 404, 'unknown tournament');
      assertEqual((await data('/api/matches/does-not-exist')).status, 404, 'unknown match');
      assertEqual((await data('/api/tournaments/bad!id/summary')).status, 400, 'invalid id');
    });
  } finally {
    await api.close();
  }

  cleanupTestDb();
  summarize('TournamentApi');
}

main();
