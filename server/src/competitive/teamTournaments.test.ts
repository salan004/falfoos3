/**
 * Roadmap #2 — Team vs Team & 2v2 tournament tests.
 *
 * Covers: migration integrity, tournament competition validation, team
 * initialization, random/player-choice assignment, capacity + lock rules,
 * team-level bracket generation, team match results/corrections (D1), and the
 * participant team-selection API security.
 *
 * Run: `npm -w server run test` (this file is added to the chain).
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanCompetitive,
  cleanTournaments,
  seedGame,
  seedLinkedPlayer,
  seedPlayer,
  seedSession,
  seedTeam,
  seedTournament,
  seedTournamentParticipant,
  seedUser,
} from './competitiveTestSeed';
import {
  createTournament,
  getTournamentById,
  updateTournament,
} from '../games/TournamentService';
import { generateBracket, getTournamentBracket } from './BracketService';
import {
  getMatchParticipants,
  getTournamentChampion,
  getTournamentChampionTeam,
  getTournamentMatches,
  recordMatchResult,
} from './TournamentMatchService';
import { correctMatchResult } from './MatchCorrectionService';
import {
  TeamError,
  assignPlayerToTeam,
  ensureTeamsInitialized,
  getPlayerTeam,
  getTeamMembers,
  getTeams,
} from './TeamService';
import { getOrCreateProfile, getProfile } from './CompetitiveProfileService';
import { assertEqual, assertThrows, assertTrue, summarize, test, testAsync } from './testHarness';
import { cookieFor, request, startTestApi } from './apiTestHarness';

initDatabase();
assertEqual(getDb().name, testDbPath, 'isolated test database is active');

const ADMIN = 'team-admin-1';
const DG = 'game-team-dg';
seedUser(ADMIN);
seedGame(DG, 'dueling_grounds');
cleanCompetitive();
cleanTournaments();

let counter = 0;
function setup(
  competitionType: 'individual' | 'team_vs_team' | 'two_vs_two',
  formation: 'random' | 'player_choice',
  playerCount: number,
  opts?: { maxParticipants?: number | null }
): { tournamentId: string; players: string[] } {
  counter += 1;
  const tournamentId = `tt-${counter}`;
  seedTournament({
    id: tournamentId,
    gameId: DG,
    status: 'open',
    createdBy: ADMIN,
    competitionType,
    teamFormation: competitionType === 'individual' ? null : formation,
    maxParticipants: opts?.maxParticipants ?? null,
    team1Name: competitionType === 'team_vs_team' ? 'الصقور' : null,
    team2Name: competitionType === 'team_vs_team' ? 'النمور' : null,
  });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `tp-${counter}-${String(i + 1).padStart(3, '0')}`;
    seedPlayer(pid, `Player ${i + 1}`);
    seedTournamentParticipant(tournamentId, pid);
    players.push(pid);
  }
  return { tournamentId, players };
}

function count(table: string, where = ''): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM ${table} ${where}`)
    .get() as { n: number };
  return row.n;
}

/** Sum of every Elo delta recorded for a match (all ledger rows). */
function matchEloNet(matchId: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(delta), 0) AS net FROM elo_transactions WHERE match_id = ?')
    .get(matchId) as { net: number };
  return row.net;
}

/** Sum of the CURRENT (non-reversal/non-correction) match Elo deltas per side. */
function sideEloNet(matchId: string, playerIds: string[]): number {
  const placeholders = playerIds.map(() => '?').join(',');
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(delta), 0) AS net FROM elo_transactions
        WHERE match_id = ? AND source_type = 'match' AND player_id IN (${placeholders})`
    )
    .get(matchId, ...playerIds) as { net: number };
  return row.net;
}

function setElo(playerId: string, elo: number): void {
  getOrCreateProfile(playerId, DG);
  getDb()
    .prepare('UPDATE competitive_profiles SET elo = ? WHERE player_id = ? AND game_id = ?')
    .run(elo, playerId, DG);
}

console.log('=== TeamTournaments ===');

/* ----------------------------- migration integrity ------------------------ */

test('migration: integrity + foreign keys are clean and legacy tournaments are individual', () => {
  const fk = getDb().prepare('PRAGMA foreign_key_check').all();
  assertEqual(fk.length, 0, 'foreign_key_check is empty');
  const integrity = getDb().prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
  assertEqual(integrity[0].integrity_check, 'ok', 'integrity_check ok');

  const { tournamentId } = setup('individual', 'random', 2);
  const row = getTournamentById(tournamentId)!;
  assertEqual(row.competition_type, 'individual', 'legacy default competition type');
  assertEqual(row.team_formation, null, 'legacy formation is null');
  // Additive columns exist on the rebuilt participant table.
  const cols = getDb()
    .prepare("SELECT name FROM pragma_table_info('tournament_match_participants')")
    .all() as { name: string }[];
  assertTrue(cols.some((c) => c.name === 'team_id'), 'match participants have team_id');
  assertTrue(cols.some((c) => c.name === 'player_id'), 'match participants keep player_id');
});

/* --------------------------- competition validation ----------------------- */

test('admin validation: competition/formation combinations', () => {
  seedUser('creator-x');
  assertThrows(
    () =>
      createTournament(
        { game_id: DG, name_ar: 'Bad 1', competition_type: 'individual', team_formation: 'random' },
        'creator-x'
      ),
    'individual cannot have a formation'
  );
  assertThrows(
    () =>
      createTournament(
        { game_id: DG, name_ar: 'Bad 2', competition_type: 'team_vs_team' },
        'creator-x'
      ),
    'team_vs_team requires a formation'
  );
  assertThrows(
    () =>
      createTournament(
        {
          game_id: DG,
          name_ar: 'Bad 3',
          competition_type: 'two_vs_two',
          team_formation: 'player_choice',
        },
        'creator-x'
      ),
    '2v2 player-choice requires max participants'
  );
  assertThrows(
    () =>
      createTournament(
        {
          game_id: DG,
          name_ar: 'Bad 4',
          competition_type: 'two_vs_two',
          team_formation: 'random',
          team1_name: 'X',
        },
        'creator-x'
      ),
    '2v2 rejects custom team names'
  );

  const ok = createTournament(
    {
      game_id: DG,
      name_ar: 'Good Team',
      competition_type: 'team_vs_team',
      team_formation: 'player_choice',
      team1_name: 'الصقور',
      team2_name: 'النمور',
    },
    'creator-x'
  );
  assertEqual(ok.competition_type, 'team_vs_team', 'team competition persisted');
  assertEqual(ok.team1_name, 'الصقور', 'team 1 name persisted');
});

test('admin validation: competition cannot change once teams exist', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 2);
  ensureTeamsInitialized(tournamentId);
  assertThrows(
    () => updateTournament(tournamentId, { competition_type: 'individual' }),
    'cannot switch competition after teams exist'
  );
});

/* --------------------------- team_vs_team random -------------------------- */

test('team_vs_team random: two teams, all assigned once, ceil/floor split, lock, one match', () => {
  const { tournamentId, players } = setup('team_vs_team', 'random', 5);
  const result = generateBracket(tournamentId);
  assertEqual(result.matchCount, 1, 'exactly one decisive match');
  assertEqual(result.totalRounds, 1, 'one round');

  const teams = getTeams(tournamentId);
  assertEqual(teams.length, 2, 'exactly two teams');
  const sizes = teams.map((t) => getTeamMembers(t.id).length).sort((a, b) => b - a);
  assertEqual(JSON.stringify(sizes), JSON.stringify([3, 2]), 'ceil/floor split (3/2)');

  const allMembers = teams.flatMap((t) => getTeamMembers(t.id));
  assertEqual(allMembers.length, players.length, 'every participant assigned once');
  assertEqual(new Set(allMembers).size, players.length, 'no duplicate assignment');

  assertTrue(getTournamentById(tournamentId)!.teams_locked_at !== null, 'teams locked');
  const participants = getMatchParticipants(getTournamentMatches(tournamentId)[0].id);
  assertTrue(participants.every((p) => p.team_id !== null && p.player_id === null), 'match sides are teams');
});

test('team_vs_team random: odd single participant is rejected at generation', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 1);
  assertThrows(() => generateBracket(tournamentId), 'empty team rejected');
});

/* ------------------------- team_vs_team player choice --------------------- */

test('player choice: ownership, capacity, switching and lock', () => {
  const { tournamentId, players } = setup('team_vs_team', 'player_choice', 3);
  ensureTeamsInitialized(tournamentId);
  const [team1, team2] = getTeams(tournamentId);

  const r1 = assignPlayerToTeam(tournamentId, players[0], team1.id, 'player');
  assertTrue(!r1.idempotent, 'first assignment applied');
  assertEqual(getPlayerTeam(tournamentId, players[0])!.id, team1.id, 'player 0 on team 1');

  const again = assignPlayerToTeam(tournamentId, players[0], team1.id, 'player');
  assertTrue(again.idempotent, 'same-team selection is idempotent');

  const switched = assignPlayerToTeam(tournamentId, players[0], team2.id, 'player');
  assertTrue(switched.switched, 'switch recorded');
  assertEqual(getPlayerTeam(tournamentId, players[0])!.id, team2.id, 'player 0 moved to team 2');

  // Non-participant cannot be assigned.
  seedPlayer('outsider-1', 'Outsider');
  assertThrows(() => assignPlayerToTeam(tournamentId, 'outsider-1', team1.id, 'player'), 'non-participant rejected');

  // Lock blocks all further selection.
  getDb().prepare('UPDATE tournaments SET teams_locked_at = ? WHERE id = ?').run(Date.now(), tournamentId);
  assertThrows(() => assignPlayerToTeam(tournamentId, players[1], team1.id, 'player'), 'locked teams reject selection');
});

test('random formation: player self-selection is rejected; admin correction still allowed', () => {
  const { tournamentId, players } = setup('team_vs_team', 'random', 2);
  ensureTeamsInitialized(tournamentId);
  const team = getTeams(tournamentId)[0];
  assertThrows(
    () => assignPlayerToTeam(tournamentId, players[0], team.id, 'player'),
    'random formation rejects player selection'
  );
  assignPlayerToTeam(tournamentId, players[0], team.id, 'admin');
  assertEqual(getPlayerTeam(tournamentId, players[0])!.id, team.id, 'admin correction allowed pre-lock');
});

/* ------------------------------- 2v2 random ------------------------------- */

test('2v2 random: pairs of exactly two, team-level bracket, no duplicates', () => {
  const { tournamentId } = setup('two_vs_two', 'random', 6);
  const result = generateBracket(tournamentId);
  const teams = getTeams(tournamentId);
  assertEqual(teams.length, 3, 'six players → three teams');
  for (const team of teams) {
    assertEqual(team.capacity, 2, 'capacity exactly 2');
    assertEqual(getTeamMembers(team.id).length, 2, 'exactly two members');
  }
  const members = teams.flatMap((t) => getTeamMembers(t.id));
  assertEqual(new Set(members).size, 6, 'no duplicate players');
  assertEqual(result.bracketSize, 4, 'four-team bracket');
  assertEqual(result.byes, 1, 'one team-level bye');
});

test('2v2 random: odd roster leaves a player unassigned and is rejected', () => {
  const { tournamentId } = setup('two_vs_two', 'random', 5);
  assertThrows(() => generateBracket(tournamentId), 'incomplete 2v2 roster rejected');
});

/* ------------------------------- 2v2 choice ------------------------------- */

test('2v2 choice: capacity two, full team rejected, switch allowed before lock', () => {
  const { tournamentId, players } = setup('two_vs_two', 'player_choice', 4, { maxParticipants: 4 });
  ensureTeamsInitialized(tournamentId);
  const teams = getTeams(tournamentId);
  assertEqual(teams.length, 2, 'two teams for four max participants');

  assignPlayerToTeam(tournamentId, players[0], teams[0].id, 'player');
  assignPlayerToTeam(tournamentId, players[1], teams[0].id, 'player');
  assertThrows(() => assignPlayerToTeam(tournamentId, players[2], teams[0].id, 'player'), 'team full (2/2)');

  // Switching away releases the slot.
  assignPlayerToTeam(tournamentId, players[1], teams[1].id, 'player');
  assignPlayerToTeam(tournamentId, players[2], teams[0].id, 'player');
  assertEqual(getTeamMembers(teams[0].id).length, 2, 'team 0 full again after switch');
});

test('2v2 choice: complete roster generates a team bracket; incomplete is rejected', () => {
  const { tournamentId, players } = setup('two_vs_two', 'player_choice', 4, { maxParticipants: 4 });
  ensureTeamsInitialized(tournamentId);
  const teams = getTeams(tournamentId);
  for (let i = 0; i < 4; i++) assignPlayerToTeam(tournamentId, players[i], teams[Math.floor(i / 2)].id, 'player');

  const result = generateBracket(tournamentId);
  assertEqual(result.matchCount, 1, 'two teams → one final');
  assertTrue(getTournamentById(tournamentId)!.teams_locked_at !== null, 'locked on generation');

  const inc = setup('two_vs_two', 'player_choice', 3, { maxParticipants: 4 });
  ensureTeamsInitialized(inc.tournamentId);
  const incTeams = getTeams(inc.tournamentId);
  assignPlayerToTeam(inc.tournamentId, inc.players[0], incTeams[0].id, 'player');
  assignPlayerToTeam(inc.tournamentId, inc.players[1], incTeams[0].id, 'player');
  assertThrows(() => generateBracket(inc.tournamentId), 'incomplete 2v2 roster rejected');
});

/* ------------------------------- team results ----------------------------- */

test('team result: every winning member wins, every losing member loses, champion is the team', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 4);
  generateBracket(tournamentId);
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  const winnerTeamId = parts[0].team_id!;
  const winnerMembers = getTeamMembers(winnerTeamId);
  const loserTeamId = parts[1].team_id!;
  const loserMembers = getTeamMembers(loserTeamId);

  const before = count('lp_transactions');
  const outcome = recordMatchResult({ matchId: match.id, winnerTeamId });
  assertEqual(outcome.winnerTeamId, winnerTeamId, 'winning team recorded');
  assertEqual(outcome.loserTeamId, loserTeamId, 'losing team recorded');
  assertTrue(outcome.tournamentCompleted, 'final completes the tournament');
  assertEqual(getTournamentChampionTeam(tournamentId), winnerTeamId, 'champion team');
  assertEqual(getTournamentChampion(tournamentId), null, 'no individual champion');

  for (const pid of winnerMembers) assertEqual(getProfile(pid, DG)!.wins, 1, `winner ${pid} has a win`);
  for (const pid of loserMembers) assertEqual(getProfile(pid, DG)!.losses, 1, `loser ${pid} has a loss`);
  assertEqual(count('lp_transactions') - before, (winnerMembers.length + loserMembers.length) * 1, 'one LP row per member');

  // Elo: individual per member, exactly zero-sum across both teams.
  assertEqual(matchEloNet(match.id), 0, 'team Elo aggregate is exactly zero');
  assertTrue(sideEloNet(match.id, winnerMembers) > 0, 'winning members gain Elo');
  assertTrue(sideEloNet(match.id, loserMembers) < 0, 'losing members lose Elo');
});

test('team result: idempotent replay applies no additional effects', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 2);
  generateBracket(tournamentId);
  const match = getTournamentMatches(tournamentId)[0];
  const teamId = getMatchParticipants(match.id)[0].team_id!;
  const key = `team-replay:${match.id}`;
  recordMatchResult({ matchId: match.id, winnerTeamId: teamId, idempotencyKey: key });
  const lpAfterFirst = count('lp_transactions');
  const eloAfterFirst = matchEloNet(match.id);
  const replay = recordMatchResult({ matchId: match.id, winnerTeamId: teamId, idempotencyKey: key });
  assertTrue(replay.alreadyProcessed, 'replay detected');
  assertEqual(count('lp_transactions'), lpAfterFirst, 'no double application');
  assertEqual(matchEloNet(match.id), eloAfterFirst, 'no double Elo application');
});

test('team Elo: 3v2 with different ratings is exactly zero-sum and rating-sensitive', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 5);
  generateBracket(tournamentId);
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  const teamA = parts[0].team_id!;
  const teamB = parts[1].team_id!;
  const aMembers = getTeamMembers(teamA);
  const bMembers = getTeamMembers(teamB);
  [...aMembers, ...bMembers].forEach((pid, index) => setElo(pid, 1000 + index * 150));

  recordMatchResult({ matchId: match.id, winnerTeamId: teamA });
  assertEqual(matchEloNet(match.id), 0, 'aggregate zero-sum (unequal sizes)');
  assertTrue(sideEloNet(match.id, aMembers) > 0, 'winning side positive');
  assertTrue(sideEloNet(match.id, bMembers) < 0, 'losing side negative');
  const finalElos = [...aMembers, ...bMembers].map((pid) => getProfile(pid, DG)!.elo);
  assertTrue(new Set(finalElos).size > 1, 'per-member deltas reflect individual ratings');
});

test('2v2 Elo: exactly zero-sum with mixed individual ratings', () => {
  const { tournamentId } = setup('two_vs_two', 'random', 4);
  generateBracket(tournamentId);
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  const teamA = parts[0].team_id!;
  const teamB = parts[1].team_id!;
  const aMembers = getTeamMembers(teamA);
  const bMembers = getTeamMembers(teamB);
  setElo(aMembers[0], 1600);
  setElo(aMembers[1], 1000);
  setElo(bMembers[0], 1450);
  setElo(bMembers[1], 1150);

  recordMatchResult({ matchId: match.id, winnerTeamId: teamB });
  assertEqual(matchEloNet(match.id), 0, '2v2 zero-sum');
  assertTrue(sideEloNet(match.id, bMembers) > 0, 'winning side positive');
  assertTrue(sideEloNet(match.id, aMembers) < 0, 'losing side negative');
});

test('team correction: corrected winner reconciles per-member competitive effects', () => {
  const { tournamentId } = setup('team_vs_team', 'random', 4);
  generateBracket(tournamentId);
  const match = getTournamentMatches(tournamentId)[0];
  const parts = getMatchParticipants(match.id);
  const teamA = parts[0].team_id!;
  const teamB = parts[1].team_id!;
  const teamAMembers = getTeamMembers(teamA);
  const teamBMembers = getTeamMembers(teamB);

  const allMembers = [...teamAMembers, ...teamBMembers];
  const sumEloBeforeCorrection = allMembers.reduce(
    (s, pid) => s + getOrCreateProfile(pid, DG).elo,
    0
  );

  recordMatchResult({ matchId: match.id, winnerTeamId: teamA });
  assertEqual(getTournamentChampionTeam(tournamentId), teamA, 'original champion');
  assertEqual(matchEloNet(match.id), 0, 'original team Elo zero-sum');

  const correction = correctMatchResult({
    matchId: match.id,
    correctedWinnerTeamId: teamB,
    reason: 'review',
  });
  assertEqual(correction.correctedWinnerTeamId, teamB, 'corrected to team B');
  assertEqual(getTournamentChampionTeam(tournamentId), teamB, 'champion corrected');
  for (const pid of teamAMembers) assertEqual(getProfile(pid, DG)!.wins, 0, `team A ${pid} no longer a winner`);
  for (const pid of teamBMembers) assertEqual(getProfile(pid, DG)!.wins, 1, `team B ${pid} now a winner`);
  assertEqual(getProfile(teamAMembers[0], DG)!.losses, 1, 'team A member now has a loss');
  // Correction must conserve the aggregate rating (reversal + corrected are
  // each zero-sum), and the ledger as a whole must remain zero-sum.
  assertEqual(matchEloNet(match.id), 0, 'aggregate Elo still zero-sum after correction');
  const sumEloAfterCorrection = allMembers.reduce((s, pid) => s + getOrCreateProfile(pid, DG).elo, 0);
  assertEqual(sumEloAfterCorrection, sumEloBeforeCorrection, 'correction conserves total Elo');
});

/* --------------------------------- API ------------------------------------ */

const API_USER = 'team-api-user';
const API_OUTSIDER = 'team-api-outsider';
seedUser(API_USER, 'user');
seedUser(API_OUTSIDER, 'user');

async function runApiTests(): Promise<void> {
  const api = await startTestApi();
  const { tournamentId, players } = setup('two_vs_two', 'player_choice', 3, { maxParticipants: 6 });
  ensureTeamsInitialized(tournamentId);
  // Link the first player's identity to API_USER (non-admin).
  seedLinkedPlayer(players[0], API_USER, 'UC' + 'a'.repeat(22));
  const session = seedSession(API_USER, 'user');
  const outsiderSession = seedSession(API_OUTSIDER, 'user');
  const adminSession = seedSession(ADMIN);
  const targetTeam = getTeams(tournamentId)[0].id;
  const selectionUrl = `/api/tournaments/${tournamentId}/team-selection`;

  try {
    await testAsync('security: unauthenticated team selection is rejected', async () => {
      const res = await request(api.baseUrl, selectionUrl, { method: 'POST', body: { teamId: targetTeam } });
      assertEqual(res.status, 401, 'unauthenticated selection rejected');
    });

    await testAsync('security: unlinked account is rejected', async () => {
      const res = await request(api.baseUrl, selectionUrl, {
        method: 'POST',
        body: { teamId: targetTeam },
        cookie: cookieFor(outsiderSession),
      });
      assertEqual(res.status, 409, 'unlinked account rejected');
      assertEqual((res.body as { error: string }).error, 'account_not_linked', 'account_not_linked code');
    });

    await testAsync('selection: linked registered participant can choose a team', async () => {
      const res = await request(api.baseUrl, selectionUrl, {
        method: 'POST',
        body: { teamId: targetTeam },
        cookie: cookieFor(session),
      });
      assertEqual(res.status, 200, 'selection accepted');
      assertEqual((res.body as { playerTeamId: string }).playerTeamId, targetTeam, 'selection persisted');
    });

    await testAsync('validation: unknown team and invalid id are rejected', async () => {
      const unknown = await request(api.baseUrl, selectionUrl, {
        method: 'POST',
        body: { teamId: '00000000-0000-0000-0000-000000000000' },
        cookie: cookieFor(session),
      });
      assertEqual(unknown.status, 404, 'unknown team rejected');
      const invalid = await request(api.baseUrl, selectionUrl, {
        method: 'POST',
        body: { teamId: 'bad!id' },
        cookie: cookieFor(session),
      });
      assertEqual(invalid.status, 400, 'invalid team id rejected');
    });

    await testAsync('read: public team projection reflects membership', async () => {
      const read = await request<{ teams: { id: string; memberCount: number }[] }>(
        api.baseUrl,
        `/api/tournaments/${tournamentId}/teams`
      );
      assertEqual(read.status, 200, 'public team read works');
      const readTeam = read.body.teams.find((t) => t.id === targetTeam)!;
      assertEqual(readTeam.memberCount, 1, 'member count reflected');
    });

    await testAsync('admin: randomize is forbidden for non-admins and allowed for admins', async () => {
      const randomizeUrl = `/api/admin/tournaments/${tournamentId}/teams/randomize`;
      const forbidden = await request(api.baseUrl, randomizeUrl, {
        method: 'POST',
        cookie: cookieFor(session),
      });
      assertEqual(forbidden.status, 403, 'non-admin randomize forbidden');
      const allowed = await request(api.baseUrl, randomizeUrl, {
        method: 'POST',
        cookie: cookieFor(adminSession),
      });
      assertEqual(allowed.status, 200, 'admin randomize allowed');
    });
  } finally {
    await api.close();
  }
}

runApiTests()
  .then(() => {
    cleanupTestDb();
    summarize('TeamTournaments');
  })
  .catch((err) => {
    console.error(err);
    cleanupTestDb();
    summarize('TeamTournaments');
    process.exit(1);
  });
