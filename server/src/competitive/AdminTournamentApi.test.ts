/**
 * Phase 4D — admin tournament API tests: authorization, bracket generation,
 * result recording, idempotency, state machine, disputes, validation, security
 * and cross-game isolation.
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
  seedSession,
  seedTournament,
  seedTournamentParticipant,
} from './competitiveTestSeed';
import { generateBracket } from './BracketService';
import { getMatchParticipants, getTournamentMatches } from './TournamentMatchService';
import { getProfile } from './CompetitiveProfileService';
import { startTestApi, request, cookieFor, type TestApi } from './apiTestHarness';
import { assertEqual, assertNull, assertTrue, summarize, testAsync } from './testHarness';

const DG = 'adm-game-dg';
const RL = 'adm-game-rl';
const ADMIN_ID = 'adm-admin';
const USER_ID = 'adm-user';

let api: TestApi;
let adminCookie: string;
let userCookie: string;

function call(path: string, init?: { method?: string; body?: unknown; cookie?: string }) {
  return request<Record<string, any>>(api.baseUrl, path, init);
}
function admin(path: string, init?: { method?: string; body?: unknown }) {
  return call(path, { ...init, cookie: adminCookie });
}
function user(path: string, init?: { method?: string; body?: unknown }) {
  return call(path, { ...init, cookie: userCookie });
}

function setupTournament(id: string, playerCount: number, gameId = DG): string[] {
  seedTournament({ id, gameId, status: 'open', createdBy: ADMIN_ID });
  const players: string[] = [];
  for (let i = 0; i < playerCount; i++) {
    const pid = `${id}-p${i + 1}`;
    seedPlayer(pid, `Player ${i + 1}`);
    seedTournamentParticipant(id, pid);
    players.push(pid);
  }
  return players;
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');
  adminCookie = cookieFor(seedSession(ADMIN_ID, 'admin'));
  userCookie = cookieFor(seedSession(USER_ID, 'user'));
  seedGame(DG, 'dueling_grounds');
  seedGame(RL, 'rocket_league');
  cleanCompetitive();
  cleanTournaments();

  console.log('=== AdminTournamentApi ===');

  api = await startTestApi();
  try {
    /* --------------------------- authorization --------------------------- */
    const AUTH_ID = 'adm-auth';
    setupTournament(AUTH_ID, 4);

    await testAsync('unauthenticated bracket generation is rejected (401)', async () => {
      const res = await call(`/api/admin/tournaments/${AUTH_ID}/bracket`, { method: 'POST' });
      assertEqual(res.status, 401, 'status');
      assertEqual(res.body.error, 'unauthorized', 'error');
    });

    await testAsync('a normal authenticated user is forbidden (403)', async () => {
      const res = await user(`/api/admin/tournaments/${AUTH_ID}/bracket`, { method: 'POST' });
      assertEqual(res.status, 403, 'status');
      assertEqual(res.body.error, 'forbidden', 'error');
    });

    await testAsync('an admin generates the bracket (201) and the tournament becomes active', async () => {
      const res = await admin(`/api/admin/tournaments/${AUTH_ID}/bracket`, { method: 'POST' });
      assertEqual(res.status, 201, 'status');
      assertEqual(res.body.generation.matchCount, 3, 'match count');
      assertEqual(res.body.bracket.totalRounds, 2, 'rounds');
      const state = await admin(`/api/admin/tournaments/${AUTH_ID}/state`);
      assertEqual(state.status, 200, 'state status');
      assertEqual(state.body.tournament.status, 'active', 'tournament active');
    });

    await testAsync('bracket generation is locked after the first call (409)', async () => {
      const res = await admin(`/api/admin/tournaments/${AUTH_ID}/bracket`, { method: 'POST' });
      assertEqual(res.status, 409, 'status');
      assertEqual(res.body.error, 'already_generated', 'error');
    });

    await testAsync('admin can read bracket and matches', async () => {
      const bracket = await admin(`/api/admin/tournaments/${AUTH_ID}/bracket`);
      assertEqual(bracket.status, 200, 'bracket');
      const matches = await admin(`/api/admin/tournaments/${AUTH_ID}/matches`);
      assertEqual(matches.status, 200, 'matches');
      assertEqual((matches.body.matches as any[]).length, 3, 'three matches');
    });

    /* --------------------------- result + effects ------------------------ */
    const RESULT_ID = 'adm-result';
    const resultPlayers = setupTournament(RESULT_ID, 2);
    await admin(`/api/admin/tournaments/${RESULT_ID}/bracket`, { method: 'POST' });
    const finalMatch = getTournamentMatches(RESULT_ID)[0];
    const champion = resultPlayers[0];
    const loser = resultPlayers[1];

    await testAsync('admin records a result and competitive effects apply exactly once', async () => {
      const res = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: champion },
      });
      assertEqual(res.status, 200, 'status');
      assertEqual(res.body.result.winnerPlayerId, champion, 'winner');
      assertEqual(res.body.result.tournamentCompleted, true, 'completed');
      assertEqual(res.body.result.championPlayerId, champion, 'champion');

      assertEqual(getProfile(champion, DG)!.lp, 25, 'winner +25 LP');
      assertEqual(getProfile(champion, DG)!.elo, 1216, 'winner Elo');
      assertEqual(getProfile(loser, DG)!.lp, 0, 'loser floored (started 0)');
      assertEqual(getProfile(champion, DG)!.wins, 1, 'winner stat');
      assertEqual(getProfile(loser, DG)!.losses, 1, 'loser stat');
    });

    await testAsync('idempotent replay does not double-apply competitive effects', async () => {
      const lpBefore = countRows('lp_transactions');
      const eloBefore = countRows('elo_transactions');
      const res = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: champion },
      });
      assertEqual(res.status, 200, 'status');
      assertEqual(res.body.result.alreadyProcessed, true, 'replay flagged');
      assertEqual(countRows('lp_transactions'), lpBefore, 'LP unchanged');
      assertEqual(countRows('elo_transactions'), eloBefore, 'Elo unchanged');
    });

    await testAsync('a completed match rejects a different result (409)', async () => {
      const res = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: loser, idempotencyKey: 'adm:different' },
      });
      assertEqual(res.status, 409, 'status');
      assertEqual(res.body.error, 'match_already_completed', 'error');
    });

    /* ----------------------- disputes & state machine -------------------- */
    await testAsync('dispute flow: open, block result, resolve; reversal deferred', async () => {
      const open = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/dispute`, {
        method: 'POST',
        body: { action: 'open' },
      });
      assertEqual(open.status, 200, 'open status');
      assertEqual(open.body.match.status, 'disputed', 'disputed');

      const blocked = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: loser },
      });
      assertEqual(blocked.status, 409, 'result blocked');
      assertEqual(blocked.body.error, 'match_disputed', 'error');

      const reverse = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/dispute`, {
        method: 'POST',
        body: { action: 'resolve', resolution: 'cancelled' },
      });
      assertEqual(reverse.status, 409, 'reversal deferred');
      assertEqual(reverse.body.error, 'correction_deferred', 'error');

      const resolve = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${finalMatch.id}/dispute`, {
        method: 'POST',
        body: { action: 'resolve', resolution: 'completed' },
      });
      assertEqual(resolve.status, 200, 'resolved');
      assertEqual(resolve.body.match.status, 'completed', 'completed');
    });

    await testAsync('status endpoint enforces the state machine and blocks raw completion', async () => {
      const STATUS_ID = 'adm-status';
      setupTournament(STATUS_ID, 4);
      await admin(`/api/admin/tournaments/${STATUS_ID}/bracket`, { method: 'POST' });
      const match = getTournamentMatches(STATUS_ID).find((m) => m.round_no === 1)!;

      const rawComplete = await admin(`/api/admin/tournaments/${STATUS_ID}/matches/${match.id}/status`, {
        method: 'PATCH',
        body: { status: 'completed' },
      });
      assertEqual(rawComplete.status, 400, 'raw completion rejected');
      assertEqual(rawComplete.body.error, 'invalid_status', 'error');

      const bad = await admin(`/api/admin/tournaments/${STATUS_ID}/matches/${match.id}/status`, {
        method: 'PATCH',
        body: { status: 'bogus' },
      });
      assertEqual(bad.status, 400, 'bogus rejected');

      const active = await admin(`/api/admin/tournaments/${STATUS_ID}/matches/${match.id}/status`, {
        method: 'PATCH',
        body: { status: 'active' },
      });
      assertEqual(active.status, 200, 'started');
      assertEqual(active.body.match.status, 'active', 'active');

      const cancelled = await admin(`/api/admin/tournaments/${STATUS_ID}/matches/${match.id}/status`, {
        method: 'PATCH',
        body: { status: 'cancelled' },
      });
      assertEqual(cancelled.status, 200, 'cancelled');
      assertEqual(cancelled.body.match.status, 'cancelled', 'cancelled status');

      const reinstate = await admin(`/api/admin/tournaments/${STATUS_ID}/matches/${match.id}/status`, {
        method: 'PATCH',
        body: { status: 'active' },
      });
      assertEqual(reinstate.status, 409, 'cancelled cannot be reactivated');
    });

    /* ------------------------------ validation --------------------------- */
    await testAsync('validation: invalid ids, winner, and cross-tournament scope', async () => {
      assertEqual((await admin('/api/admin/tournaments/bad!id/bracket', { method: 'POST' })).status, 400, 'bad tournament id');

      const VALID_ID = 'adm-valid';
      setupTournament(VALID_ID, 2);
      await admin(`/api/admin/tournaments/${VALID_ID}/bracket`, { method: 'POST' });
      const m = getTournamentMatches(VALID_ID)[0];

      const emptyWinner = await admin(`/api/admin/tournaments/${VALID_ID}/matches/${m.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: '' },
      });
      assertEqual(emptyWinner.status, 400, 'empty winner');

      const outsider = await admin(`/api/admin/tournaments/${VALID_ID}/matches/${m.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: 'not-a-participant' },
      });
      assertEqual(outsider.status, 400, 'outsider rejected');
      assertEqual(outsider.body.error, 'winner_not_participant', 'error');

      const wrongScope = await admin(`/api/admin/tournaments/${RESULT_ID}/matches/${m.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: 'x' },
      });
      assertEqual(wrongScope.status, 404, 'match not in tournament');

      const wrongSource = await admin(`/api/admin/tournaments/${VALID_ID}/matches/${m.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: getMatchParticipants(m.id)[0].player_id, resultSource: 'hacker' },
      });
      assertEqual(wrongSource.status, 400, 'invalid result source');
    });

    await testAsync('security: client-supplied LP/Elo/rank/champion are ignored', async () => {
      const SEC_ID = 'adm-security';
      const players = setupTournament(SEC_ID, 2);
      await admin(`/api/admin/tournaments/${SEC_ID}/bracket`, { method: 'POST' });
      const m = getTournamentMatches(SEC_ID)[0];

      const res = await admin(`/api/admin/tournaments/${SEC_ID}/matches/${m.id}/result`, {
        method: 'POST',
        body: {
          winnerPlayerId: players[0],
          lp: 99999,
          elo: 99999,
          rank: 'legendary_1',
          rankKey: 'legendary_1',
          championPlayerId: 'attacker',
          tournamentCompleted: false,
        },
      });
      assertEqual(res.status, 200, 'accepted');
      assertEqual(getProfile(players[0], DG)!.lp, 25, 'LP uses the rule, not the client');
      assertEqual(getProfile(players[0], DG)!.elo, 1216, 'Elo uses the engine');
      assertEqual(res.body.result.championPlayerId, players[0], 'champion is the real winner');
    });

    /* ------------------------- result correction ------------------------- */
    const CORR_ID = 'adm-corr';
    const corrPlayers = setupTournament(CORR_ID, 2);
    await admin(`/api/admin/tournaments/${CORR_ID}/bracket`, { method: 'POST' });
    const corrMatch = getTournamentMatches(CORR_ID)[0];
    const corrA = corrPlayers[0];
    const corrB = corrPlayers[1];
    await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
      method: 'POST',
      body: { winnerPlayerId: corrA },
    });

    await testAsync('correction: unauthenticated (401) and non-admin (403) are rejected', async () => {
      const anon = await call(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'x' },
      });
      assertEqual(anon.status, 401, 'unauth status');
      const normal = await user(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'x' },
      });
      assertEqual(normal.status, 403, 'forbidden status');
      assertEqual(getMatchParticipants(corrMatch.id).length, 2, 'match untouched');
    });

    await testAsync('correction: validation rejects missing reason and invalid winner', async () => {
      const noReason = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB },
      });
      assertEqual(noReason.status, 400, 'missing reason status');
      assertEqual(noReason.body.error, 'missing_reason', 'missing reason error');

      const badWinner = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: 'not-a-player', reason: 'x' },
      });
      assertEqual(badWinner.status, 400, 'invalid winner status');
      assertEqual(badWinner.body.error, 'invalid_corrected_winner', 'invalid winner error');

      const wrongScope = await admin(`/api/admin/tournaments/${CORR_ID}/matches/does-not-exist/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'x' },
      });
      assertEqual(wrongScope.status, 404, 'unknown match in tournament');
    });

    await testAsync('correction: admin flips the result and public state reflects it', async () => {
      const res = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'wrong winner' },
      });
      assertEqual(res.status, 200, 'status');
      assertEqual(res.body.correction.correctedWinnerPlayerId, corrB, 'corrected winner');
      assertEqual(res.body.correction.changed, true, 'changed');
      assertEqual(getProfile(corrB, DG)!.wins, 1, 'B now has the win');
      assertEqual(getProfile(corrA, DG)!.losses, 1, 'A now has the loss');
      assertEqual(getProfile(corrB, DG)!.lp, 25, 'B +25 LP');
      assertEqual(getProfile(corrB, DG)!.elo, 1216, 'B Elo');

      const summary = await call(`/api/tournaments/${CORR_ID}/summary`);
      assertEqual(summary.body.tournament.championPlayerId, corrB, 'public champion corrected');
      const matches = await call(`/api/tournaments/${CORR_ID}/matches`);
      assertEqual(matches.body.matches[0].winnerPlayerId, corrB, 'public match winner corrected');
    });

    await testAsync('correction: client-supplied LP/Elo are ignored', async () => {
      const res = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrA, reason: 'back', lp: 99999, elo: 99999 },
      });
      assertEqual(res.status, 200, 'status');
      assertEqual(getProfile(corrA, DG)!.lp, 25, 'LP follows the rule');
      assertEqual(getProfile(corrA, DG)!.elo, 1216, 'Elo follows the engine');
    });

    await testAsync('correction: idempotent replay applies once', async () => {
      const key = 'adm:corr:replay';
      const first = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'replay', idempotencyKey: key },
      });
      assertEqual(first.status, 200, 'first');
      const lpCount = countRows('lp_transactions');
      const second = await admin(`/api/admin/tournaments/${CORR_ID}/matches/${corrMatch.id}/result`, {
        method: 'PATCH',
        body: { correctedWinnerPlayerId: corrB, reason: 'replay', idempotencyKey: key },
      });
      assertEqual(second.status, 200, 'second');
      assertEqual(second.body.correction.alreadyProcessed, true, 'replay flagged');
      assertEqual(countRows('lp_transactions'), lpCount, 'no extra LP rows');
    });

    await testAsync('cross-game: a Dueling Grounds match never mutates Rocket League', async () => {
      const CROSS_DG = 'adm-cross-dg';
      const CROSS_RL = 'adm-cross-rl';
      const players = [`${CROSS_DG}-a`, `${CROSS_RL}-b`];
      seedTournament({ id: CROSS_DG, gameId: DG, status: 'open', createdBy: ADMIN_ID });
      seedTournament({ id: CROSS_RL, gameId: RL, status: 'open', createdBy: ADMIN_ID });
      for (const pid of players) {
        seedPlayer(pid, pid);
        seedTournamentParticipant(CROSS_DG, pid);
        seedTournamentParticipant(CROSS_RL, pid);
      }
      await admin(`/api/admin/tournaments/${CROSS_DG}/bracket`, { method: 'POST' });
      await admin(`/api/admin/tournaments/${CROSS_RL}/bracket`, { method: 'POST' });
      const dgMatch = getTournamentMatches(CROSS_DG)[0];
      await admin(`/api/admin/tournaments/${CROSS_DG}/matches/${dgMatch.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: players[0] },
      });
      assertTrue(getProfile(players[0], DG)!.lp === 25, 'DG updated');
      assertNull(getProfile(players[0], RL), 'RL untouched');
    });

    /* ------------------------ tournament cancellation -------------------- */
    const tcount = (table: 'tournament_participants' | 'tournament_matches', tid: string) =>
      (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tournament_id = ?`).get(tid) as { n: number }).n;

    await testAsync('cancellation: draft/open/active → cancelled via admin PATCH', async () => {
      for (const status of ['draft', 'open', 'active'] as const) {
        const id = `adm-cxl-${status}`;
        seedTournament({ id, gameId: DG, status, createdBy: ADMIN_ID });
        const res = await admin(`/api/admin/tournaments/${id}`, {
          method: 'PATCH',
          body: { status: 'cancelled' },
        });
        assertEqual(res.status, 200, `${status} status`);
        assertEqual(res.body.tournament.status, 'cancelled', `${status} → cancelled`);
      }
    });

    await testAsync('cancellation: completed is terminal; re-cancelling is an idempotent no-op', async () => {
      const done = 'adm-cxl-done';
      seedTournament({ id: done, gameId: DG, status: 'completed', createdBy: ADMIN_ID });
      const r1 = await admin(`/api/admin/tournaments/${done}`, { method: 'PATCH', body: { status: 'cancelled' } });
      assertEqual(r1.status, 400, 'completed → cancelled rejected');

      // Existing updateTournament only validates status *changes*; setting the
      // same status is a harmless no-op (no destructive effect).
      const already = 'adm-cxl-already';
      seedTournament({ id: already, gameId: DG, status: 'cancelled', createdBy: ADMIN_ID });
      const r2 = await admin(`/api/admin/tournaments/${already}`, { method: 'PATCH', body: { status: 'cancelled' } });
      assertEqual(r2.status, 200, 're-cancel is a no-op');
      assertEqual(r2.body.tournament.status, 'cancelled', 'stays cancelled');
    });

    await testAsync('cancellation: authorization is enforced (401/403)', async () => {
      const id = 'adm-cxl-auth';
      seedTournament({ id, gameId: DG, status: 'open', createdBy: ADMIN_ID });
      const anon = await call(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      assertEqual(anon.status, 401, 'unauthenticated');
      const normal = await user(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      assertEqual(normal.status, 403, 'non-admin');
    });

    await testAsync('cancellation is non-destructive and blocks further progression', async () => {
      const id = 'adm-cxl-run-active';
      setupTournament(id, 4);
      await admin(`/api/admin/tournaments/${id}/bracket`, { method: 'POST' });
      const match = getTournamentMatches(id).find((m) => m.round_no === 1)!;
      assertTrue(!!match, 'round-1 match exists');
      const combatants = getMatchParticipants(match.id).map((p) => p.player_id);
      const beforeP = tcount('tournament_participants', id);
      const beforeM = tcount('tournament_matches', id);
      assertEqual(beforeP, 4, 'participants seeded');
      assertEqual(beforeM, 3, 'matches seeded');

      const res = await admin(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { status: 'cancelled' } });
      assertEqual(res.status, 200, 'cancelled');
      assertEqual(res.body.tournament.status, 'cancelled', 'cancelled status');

      // Non-destructive: participants + matches are preserved.
      assertEqual(tcount('tournament_participants', id), beforeP, 'participants preserved');
      assertEqual(tcount('tournament_matches', id), beforeM, 'matches preserved');

      // Further progression is blocked by the existing rules.
      const result = await admin(`/api/admin/tournaments/${id}/matches/${match.id}/result`, {
        method: 'POST',
        body: { winnerPlayerId: combatants[0] },
      });
      assertEqual(result.status, 409, 'result blocked');
      assertEqual(result.body.error, 'tournament_not_active', 'result reason');

      const openId = 'adm-cxl-run-open';
      setupTournament(openId, 2);
      await admin(`/api/admin/tournaments/${openId}`, { method: 'PATCH', body: { status: 'cancelled' } });
      const bracketRes = await admin(`/api/admin/tournaments/${openId}/bracket`, { method: 'POST' });
      assertEqual(bracketRes.status, 409, 'bracket blocked');
      assertEqual(bracketRes.body.error, 'invalid_tournament_state', 'bracket reason');
    });

    await testAsync('R5: DELETE is a non-destructive hide alias (no hard delete, status unchanged)', async () => {
      const id = 'adm-hide-delete';
      seedTournament({ id, gameId: DG, status: 'open', createdBy: ADMIN_ID });
      const res = await call(`/api/admin/tournaments/${id}`, { method: 'DELETE', cookie: adminCookie });
      assertEqual(res.status, 200, 'hide accepted');
      assertEqual(res.body.hidden, true, 'response marks hidden');
      const row = getDb()
        .prepare('SELECT id, status, hidden_at FROM tournaments WHERE id = ?')
        .get(id) as { id: string; status: string; hidden_at: number | null } | undefined;
      assertTrue(!!row, 'tournament row preserved');
      assertEqual(row!.status, 'open', 'lifecycle status unchanged');
      assertTrue(row!.hidden_at !== null, 'hidden_at set');
    });
  } finally {
    await api.close();
  }

  cleanupTestDb();
  summarize('AdminTournamentApi');
}

main();
