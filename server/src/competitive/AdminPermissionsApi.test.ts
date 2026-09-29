/**
 * Admin Control & Permissions — moderator system API tests.
 *
 * Covers the full three-tier matrix (user / LIMITED_ADMIN / SUPER_ADMIN),
 * the `can_create_tournaments` toggle, tournament-management lockout, games /
 * trivia lockout, moderator promote/demote, and permission-escalation safety.
 *
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanCompetitive,
  cleanTournaments,
  seedAdminPermission,
  seedGame,
  seedPlayer,
  seedSession,
  seedTournament,
  seedTournamentParticipant,
} from './competitiveTestSeed';
import { getTournamentMatches } from './TournamentMatchService';
import { getAdminAccess } from '../auth/adminPermissions';
import { startTestApi, request, cookieFor, type TestApi } from './apiTestHarness';
import { assertEqual, assertTrue, summarize, testAsync } from './testHarness';

const GAME = 'perm-game';
const SUPER_ID = 'perm-super';
const LIMITED_ID = 'perm-limited';
const USER_ID = 'perm-user';
const PLAIN_ID = 'perm-plain';

let api: TestApi;
let superCookie: string;
let limitedCookie: string;
let userCookie: string;

function call(path: string, init?: { method?: string; body?: unknown; cookie?: string }) {
  return request<Record<string, any>>(api.baseUrl, path, init);
}
function asSuper(path: string, init?: { method?: string; body?: unknown }) {
  return call(path, { ...init, cookie: superCookie });
}
function asLimited(path: string, init?: { method?: string; body?: unknown }) {
  return call(path, { ...init, cookie: limitedCookie });
}
function asUser(path: string, init?: { method?: string; body?: unknown }) {
  return call(path, { ...init, cookie: userCookie });
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');

  superCookie = cookieFor(seedSession(SUPER_ID, 'admin'));
  limitedCookie = cookieFor(seedSession(LIMITED_ID, 'admin'));
  userCookie = cookieFor(seedSession(USER_ID, 'user'));
  seedAdminPermission(LIMITED_ID, { isSuper: false, canCreateTournaments: false });
  seedGame(GAME, 'permission_arena');
  cleanCompetitive();
  cleanTournaments();

  console.log('=== AdminPermissionsApi ===');

  api = await startTestApi();
  try {
    /* ------------------------------ session shape ------------------------ */

    await testAsync('GET /api/auth/me: plain user has no admin tier', async () => {
      const res = await asUser('/api/auth/me');
      assertEqual(res.status, 200, 'status');
      assertEqual(res.body.user.role, 'user', 'role');
      assertEqual(res.body.user.adminTier, undefined, 'no tier');
    });

    await testAsync('GET /api/auth/me: SUPER_ADMIN exposes tier + permission', async () => {
      const res = await asSuper('/api/auth/me');
      assertEqual(res.body.user.role, 'admin', 'role');
      assertEqual(res.body.user.adminTier, 'super', 'tier');
      assertEqual(res.body.user.permissions.canCreateTournaments, true, 'can create');
    });

    await testAsync('GET /api/auth/me: LIMITED_ADMIN exposes tier + permission', async () => {
      const res = await asLimited('/api/auth/me');
      assertEqual(res.body.user.role, 'admin', 'role');
      assertEqual(res.body.user.adminTier, 'limited', 'tier');
      assertEqual(res.body.user.permissions.canCreateTournaments, false, 'can create');
    });

    /* ------------------------------- SUPER ------------------------------- */

    await testAsync('SUPER can list and create tournaments', async () => {
      assertEqual((await asSuper('/api/admin/tournaments')).status, 200, 'list');
      const created = await asSuper('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'Super Cup', status: 'open' },
      });
      assertEqual(created.status, 201, 'create status');
      assertEqual(created.body.tournament.name_ar, 'Super Cup', 'name');
    });

    await testAsync('SUPER can edit, hide (delete) and manage a tournament', async () => {
      seedTournament({ id: 'perm-super-t', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      const patched = await asSuper('/api/admin/tournaments/perm-super-t', {
        method: 'PATCH',
        body: { status: 'active' },
      });
      assertEqual(patched.status, 200, 'patch');
      assertEqual(patched.body.tournament.status, 'active', 'status');

      const hidden = await asSuper('/api/admin/tournaments/perm-super-t', { method: 'DELETE' });
      assertEqual(hidden.status, 200, 'delete/hide');
      assertEqual(hidden.body.hidden, true, 'hidden');
    });

    await testAsync('SUPER can manage participants', async () => {
      seedTournament({ id: 'perm-super-p', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      seedPlayer('perm-super-player');
      const res = await asSuper('/api/admin/tournaments/perm-super-p/participants', {
        method: 'POST',
        body: { player_id: 'perm-super-player', source: 'admin' },
      });
      assertEqual(res.status, 201, 'participant added');
    });

    await testAsync('SUPER can read the participant roster (200)', async () => {
      const res = await asSuper('/api/admin/tournaments/perm-super-p/participants');
      assertEqual(res.status, 200, 'status');
      assertTrue(Array.isArray(res.body.participants), 'participants array');
    });

    await testAsync('SUPER can manage the bracket', async () => {
      seedTournament({ id: 'perm-super-b', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      for (let i = 0; i < 2; i++) {
        const pid = `perm-super-b-p${i}`;
        seedPlayer(pid);
        seedTournamentParticipant('perm-super-b', pid);
      }
      const res = await asSuper('/api/admin/tournaments/perm-super-b/bracket', { method: 'POST' });
      assertEqual(res.status, 201, 'bracket generated');
      assertTrue(getTournamentMatches('perm-super-b').length > 0, 'matches exist');
    });

    await testAsync('SUPER can access games and trivia administration', async () => {
      assertEqual((await asSuper('/api/admin/games')).status, 200, 'games');
      assertEqual((await asSuper('/api/admin/trivia/categories')).status, 200, 'trivia');
    });

    /* --------------------------- LIMITED — OFF --------------------------- */

    await testAsync('LIMITED (OFF) can view the tournament list', async () => {
      assertEqual((await asLimited('/api/admin/tournaments')).status, 200, 'list');
    });

    await testAsync('LIMITED (OFF) POST /api/admin/tournaments is forbidden (403)', async () => {
      const res = await asLimited('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'Forbidden Cup' },
      });
      assertEqual(res.status, 403, 'status');
      assertEqual(res.body.error, 'forbidden', 'error');
    });

    await testAsync('LIMITED (OFF) cannot edit / hide / manage participants', async () => {
      seedTournament({ id: 'perm-lim-t', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      seedPlayer('perm-lim-player');
      assertEqual(
        (await asLimited('/api/admin/tournaments/perm-lim-t', { method: 'PATCH', body: { status: 'active' } })).status,
        403,
        'patch'
      );
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-t', { method: 'DELETE' })).status, 403, 'delete');
      assertEqual(
        (await asLimited('/api/admin/tournaments/perm-lim-t/participants', {
          method: 'POST',
          body: { player_id: 'perm-lim-player', source: 'admin' },
        })).status,
        403,
        'participants'
      );
    });

    await testAsync('LIMITED (OFF) cannot READ the participant roster (403)', async () => {
      seedTournament({ id: 'perm-lim-roster', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      const res = await asLimited('/api/admin/tournaments/perm-lim-roster/participants');
      assertEqual(res.status, 403, 'status');
      assertEqual(res.body.error, 'forbidden', 'error');
    });

    await testAsync('LIMITED (OFF) cannot manage bracket / matches / results / status / disputes', async () => {
      seedTournament({ id: 'perm-lim-b', gameId: GAME, createdBy: SUPER_ID, status: 'open' });
      seedPlayer('perm-lim-b1');
      seedPlayer('perm-lim-b2');
      seedTournamentParticipant('perm-lim-b', 'perm-lim-b1');
      seedTournamentParticipant('perm-lim-b', 'perm-lim-b2');
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-b/bracket', { method: 'POST' })).status, 403, 'bracket');
      // Bracket was never generated, but the guard rejects before any handler.
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-b/matches/x/result', { method: 'POST', body: { winnerPlayerId: 'a' } })).status, 403, 'result');
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-b/matches/x/status', { method: 'PATCH', body: { status: 'active' } })).status, 403, 'status');
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-b/matches/x/dispute', { method: 'POST', body: { action: 'open' } })).status, 403, 'dispute');
      assertEqual((await asLimited('/api/admin/tournaments/perm-lim-b/teams')).status, 403, 'teams');
    });

    await testAsync('LIMITED (OFF) cannot access games / trivia / game uploads', async () => {
      assertEqual((await asLimited('/api/admin/games')).status, 403, 'games');
      assertEqual((await asLimited('/api/admin/trivia/categories')).status, 403, 'trivia');
      assertEqual((await asLimited('/api/admin/uploads/games', { method: 'POST' })).status, 403, 'games upload');
      assertEqual((await asLimited('/api/admin/uploads/tournaments', { method: 'POST' })).status, 403, 'tournament upload (OFF)');
    });

    /* ---------------------------- LIMITED — ON --------------------------- */

    await testAsync('SUPER toggles can_create_tournaments ON for the moderator', async () => {
      const res = await asSuper(`/api/admin/permissions/moderators/${LIMITED_ID}`, {
        method: 'PATCH',
        body: { canCreateTournaments: true },
      });
      assertEqual(res.status, 200, 'toggle');
      assertEqual(res.body.moderator.canCreateTournaments, true, 'value');

      const me = await asLimited('/api/auth/me');
      assertEqual(me.body.user.permissions.canCreateTournaments, true, 'reflects in me');
    });

    await testAsync('LIMITED (ON) can create a tournament', async () => {
      const res = await asLimited('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'Moderator Cup', status: 'open' },
      });
      assertEqual(res.status, 201, 'create');
      assertEqual(res.body.tournament.name_ar, 'Moderator Cup', 'name');
    });

    await testAsync('LIMITED (ON) still cannot manage the tournament it created', async () => {
      seedTournament({ id: 'perm-on-t', gameId: GAME, createdBy: LIMITED_ID, status: 'open' });
      seedPlayer('perm-on-player');
      seedPlayer('perm-on-p1');
      seedPlayer('perm-on-p2');
      seedTournamentParticipant('perm-on-t', 'perm-on-p1');
      seedTournamentParticipant('perm-on-t', 'perm-on-p2');
      assertEqual((await asLimited('/api/admin/tournaments/perm-on-t', { method: 'PATCH', body: { status: 'active' } })).status, 403, 'edit');
      assertEqual((await asLimited('/api/admin/tournaments/perm-on-t', { method: 'DELETE' })).status, 403, 'delete');
      assertEqual((await asLimited('/api/admin/tournaments/perm-on-t/bracket', { method: 'POST' })).status, 403, 'bracket');
      assertEqual(
        (await asLimited('/api/admin/tournaments/perm-on-t/participants', {
          method: 'POST',
          body: { player_id: 'perm-on-player', source: 'admin' },
        })).status,
        403,
        'participants'
      );
    });

    await testAsync('LIMITED (ON) still cannot READ the participant roster (403)', async () => {
      seedTournament({ id: 'perm-on-roster', gameId: GAME, createdBy: LIMITED_ID, status: 'open' });
      const res = await asLimited('/api/admin/tournaments/perm-on-roster/participants');
      assertEqual(res.status, 403, 'status');
      assertEqual(res.body.error, 'forbidden', 'error');
    });

    await testAsync('LIMITED (ON) tournament image upload passes the guard', async () => {
      // No file → handler answers 400 (guard allowed the request through).
      const res = await asLimited('/api/admin/uploads/tournaments', { method: 'POST' });
      assertEqual(res.status, 400, 'guard passed, no file');
    });

    /* ------------------------ permission security ------------------------ */

    await testAsync('LIMITED cannot change its own or others permissions (403)', async () => {
      assertEqual(
        (await asLimited(`/api/admin/permissions/moderators/${LIMITED_ID}`, {
          method: 'PATCH',
          body: { canCreateTournaments: false },
        })).status,
        403,
        'self toggle'
      );
      assertEqual((await asLimited('/api/admin/permissions/moderators')).status, 403, 'list moderators');
      assertEqual(
        (await asLimited('/api/admin/permissions/moderators', { method: 'POST', body: { userId: USER_ID } })).status,
        403,
        'promote'
      );
      assertEqual((await asLimited('/api/admin/permissions/users')).status, 403, 'search');
    });

    await testAsync('plain user and anonymous cannot access permission endpoints', async () => {
      assertEqual((await asUser('/api/admin/permissions/moderators')).status, 403, 'user');
      assertEqual((await call('/api/admin/permissions/moderators')).status, 401, 'anonymous');
      assertEqual((await call('/api/admin/tournaments')).status, 401, 'anonymous tournaments');
    });

    await testAsync('admin with NO admin_permissions row is NOT SUPER_ADMIN (no fail-open)', async () => {
      const NO_ROW_ID = 'perm-norow';
      const now = Date.now();
      getDb()
        .prepare(
          'INSERT OR IGNORE INTO users (id, display_name, avatar_url, role, created_at) VALUES (?, ?, NULL, ?, ?)'
        )
        .run(NO_ROW_ID, 'No Row Admin', 'admin', now);
      // Guarantee there is genuinely NO permissions row for this admin.
      getDb().prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(NO_ROW_ID);
      getDb()
        .prepare(
          'INSERT OR REPLACE INTO sessions (id, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)'
        )
        .run(`sess-${NO_ROW_ID}`, NO_ROW_ID, now, now + 24 * 60 * 60 * 1000);
      const noRowCookie = cookieFor(`sess-${NO_ROW_ID}`);

      // Resolution: role='admin' alone is never SUPER_ADMIN.
      const access = getAdminAccess(NO_ROW_ID, 'admin');
      assertEqual(access?.isSuper, false, 'not super');
      assertEqual(access?.canCreateTournaments, false, 'no create permission');

      const me = await request<Record<string, any>>(api.baseUrl, '/api/auth/me', { cookie: noRowCookie });
      assertEqual(me.body.user.role, 'admin', 'still an admin account');
      assertTrue(me.body.user.adminTier !== 'super', 'not exposed as super');
      assertEqual(me.body.user.permissions.canCreateTournaments, false, 'no create permission');

      // No SUPER-only surface is reachable (games / trivia / tournament mgmt /
      // moderator mgmt / tournament create). Socket admin keys off the same
      // non-super tier, so it is likewise denied.
      assertEqual(
        (await request(api.baseUrl, '/api/admin/games', { cookie: noRowCookie })).status,
        403,
        'games'
      );
      assertEqual(
        (await request(api.baseUrl, '/api/admin/trivia/categories', { cookie: noRowCookie })).status,
        403,
        'trivia'
      );
      assertEqual(
        (await request(api.baseUrl, '/api/admin/permissions/moderators', { cookie: noRowCookie })).status,
        403,
        'moderator management'
      );
      assertEqual(
        (await request(api.baseUrl, '/api/admin/tournaments/perm-norow-t', {
          method: 'PATCH',
          body: { status: 'active' },
          cookie: noRowCookie,
        })).status,
        403,
        'tournament management'
      );
      assertEqual(
        (await request(api.baseUrl, '/api/admin/tournaments', {
          method: 'POST',
          body: { game_id: GAME, name_ar: 'NoRow Cup' },
          cookie: noRowCookie,
        })).status,
        403,
        'tournament create'
      );
    });

    await testAsync('SUPER can promote an EXISTING user and demote them safely', async () => {
      seedSession(PLAIN_ID, 'user');
      const guestsBefore = (getDb().prepare('SELECT COUNT(*) AS n FROM guests').get() as { n: number }).n;

      const promoted = await asSuper('/api/admin/permissions/moderators', {
        method: 'POST',
        body: { userId: PLAIN_ID },
      });
      assertEqual(promoted.status, 201, 'promote');
      assertEqual(promoted.body.moderator.canCreateTournaments, false, 'defaults to OFF');

      const roleRow = getDb().prepare('SELECT role FROM users WHERE id = ?').get(PLAIN_ID) as { role: string };
      const permRow = getDb()
        .prepare('SELECT is_super, can_create_tournaments FROM admin_permissions WHERE user_id = ?')
        .get(PLAIN_ID) as { is_super: number; can_create_tournaments: number };
      assertEqual(roleRow.role, 'admin', 'role promoted');
      assertEqual(permRow.is_super, 0, 'limited');
      assertEqual(permRow.can_create_tournaments, 0, 'create off');

      const guestsAfterPromote = (getDb().prepare('SELECT COUNT(*) AS n FROM guests').get() as { n: number }).n;
      assertEqual(guestsAfterPromote, guestsBefore, 'no player/guest created on promote');

      const demoted = await asSuper(`/api/admin/permissions/moderators/${PLAIN_ID}`, { method: 'DELETE' });
      assertEqual(demoted.status, 200, 'demote');
      const roleAfter = getDb().prepare('SELECT role FROM users WHERE id = ?').get(PLAIN_ID) as { role: string };
      assertEqual(roleAfter.role, 'user', 'role restored');
      const permAfter = getDb()
        .prepare('SELECT COUNT(*) AS n FROM admin_permissions WHERE user_id = ?')
        .get(PLAIN_ID) as { n: number };
      assertEqual(permAfter.n, 0, 'permissions row removed');

      const guestsAfterDemote = (getDb().prepare('SELECT COUNT(*) AS n FROM guests').get() as { n: number }).n;
      assertEqual(guestsAfterDemote, guestsBefore, 'no player/guest created on demote');
    });

    await testAsync('SUPER cannot demote a super admin through the moderator API', async () => {
      seedAdminPermission(SUPER_ID, { isSuper: true, canCreateTournaments: true });
      const res = await asSuper(`/api/admin/permissions/moderators/${SUPER_ID}`, { method: 'DELETE' });
      assertEqual(res.status, 404, 'not a moderator');
      const role = getDb().prepare('SELECT role FROM users WHERE id = ?').get(SUPER_ID) as { role: string };
      assertEqual(role.role, 'admin', 'still admin');
    });
  } finally {
    await api.close();
  }

  cleanupTestDb();
  summarize('AdminPermissionsApi');
}

main();
