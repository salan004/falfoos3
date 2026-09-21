/**
 * R5 — tournament visual hide / archive (non-destructive visibility).
 *
 * Covers: migration 0028 (nullable hidden_at/hidden_by), hide/restore for every
 * lifecycle status WITHOUT touching `status`, visibility filtering across
 * service/public/admin surfaces, direct-detail accessibility, player-history
 * preservation, data preservation, and the purchase block for hidden
 * tournaments. Hard deletion is intentionally absent.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import {
  cleanTournaments,
  seedGame,
  seedPlayer,
  seedSession,
  seedTournament,
  seedTournamentParticipant,
} from './competitiveTestSeed';
import {
  createTournament,
  getTournamentById,
  getTournamentsByGame,
  getTournamentsWithGameInfo,
  setTournamentHidden,
} from '../games/TournamentService';
import { getPlayerTournaments, getTournamentSummary } from './CompetitiveQueryService';
import { startTestApi, request, cookieFor, type TestApi } from './apiTestHarness';
import { assertEqual, assertNull, assertTrue, summarize, test, testAsync } from './testHarness';
import { startPurchase } from '../integrations/purchaseService';
import { IntegrationError } from '../integrations/errors';
import type { SessionUser } from '../auth/session';

const GAME = 'tv-game';
const ADMIN = 'tv-admin';
const USER: SessionUser = { id: 'tv-user', displayName: 'Buyer', role: 'user' };
const CHANNEL = 'UC' + 'v'.repeat(22);

let api: TestApi;
let adminCookie: string;

function admin(path: string, init?: { method?: string; body?: unknown }) {
  return request<Record<string, any>>(api.baseUrl, path, { ...init, cookie: adminCookie });
}

function publicReq(path: string) {
  return request<Record<string, any>>(api.baseUrl, path);
}

function countWhere(table: string, tournamentId: string): number {
  return (
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tournament_id = ?`)
      .get(tournamentId) as { n: number }
  ).n;
}

function seedLinkedGuest(playerId: string, channel: string, userId: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO guests
         (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(playerId, playerId, now, now, userId, channel);
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');
  adminCookie = cookieFor(seedSession(ADMIN, 'admin'));
  seedGame(GAME, 'tv-game');
  cleanTournaments();

  console.log('=== TournamentVisibility ===');

  /* ----------------------------- migration ----------------------------- */
  test('migration 0028 adds nullable hidden_at / hidden_by', () => {
    const cols = getDb().prepare('PRAGMA table_info(tournaments)').all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    const at = cols.find((c) => c.name === 'hidden_at');
    const by = cols.find((c) => c.name === 'hidden_by');
    assertTrue(!!at && !!by, 'visibility columns exist');
    assertEqual(at!.notnull, 0, 'hidden_at nullable');
    assertEqual(by!.notnull, 0, 'hidden_by nullable');
    assertNull(at!.dflt_value, 'no default');
  });

  test('existing tournaments are visible by default (hidden_at NULL)', () => {
    seedTournament({ id: 'tv-legacy', gameId: GAME, createdBy: ADMIN });
    assertNull(getTournamentById('tv-legacy')!.hidden_at, 'legacy row visible');
  });

  /* -------------------- hide/restore across all statuses --------------- */
  test('hide/restore works for all five statuses and never changes lifecycle status', () => {
    const statuses = ['draft', 'open', 'active', 'completed', 'cancelled'] as const;
    for (const status of statuses) {
      const id = `tv-hide-${status}`;
      seedTournament({ id, gameId: GAME, status, createdBy: ADMIN });

      const hidden = setTournamentHidden(id, true, ADMIN)!;
      assertEqual(hidden.changed, true, `${status}: hide changed`);
      assertEqual(hidden.tournament.status, status, `${status}: status preserved on hide`);
      assertTrue(hidden.tournament.hidden_at !== null, `${status}: hidden_at set`);
      assertEqual(hidden.tournament.hidden_by, ADMIN, `${status}: hidden_by recorded`);

      assertEqual(setTournamentHidden(id, true, ADMIN)!.changed, false, `${status}: hide idempotent`);

      const restored = setTournamentHidden(id, false, ADMIN)!;
      assertEqual(restored.changed, true, `${status}: restore changed`);
      assertNull(restored.tournament.hidden_at, `${status}: restored visible`);
      assertEqual(restored.tournament.status, status, `${status}: status preserved on restore`);
      assertEqual(setTournamentHidden(id, false, ADMIN)!.changed, false, `${status}: restore idempotent`);
    }
  });

  test('setTournamentHidden returns null for an unknown tournament', () => {
    assertNull(setTournamentHidden('tv-missing', true, ADMIN), 'unknown tournament');
  });

  /* ------------------------- data preservation ------------------------- */
  test('hide/restore preserves tournament rows, participants and images', () => {
    const id = 'tv-preserve';
    seedTournament({ id, gameId: GAME, status: 'open', createdBy: ADMIN });
    seedPlayer('tv-preserve-p');
    seedTournamentParticipant(id, 'tv-preserve-p');
    getDb()
      .prepare('UPDATE tournaments SET image_url = ? WHERE id = ?')
      .run('/api/uploads/tournaments/abc.webp', id);

    const participantsBefore = countWhere('tournament_participants', id);
    setTournamentHidden(id, true, ADMIN);
    setTournamentHidden(id, false, ADMIN);

    assertEqual(countWhere('tournament_participants', id), participantsBefore, 'participants preserved');
    assertEqual(getTournamentById(id)!.image_url, '/api/uploads/tournaments/abc.webp', 'image_url preserved');
    assertTrue(!!getTournamentById(id), 'tournament row preserved');
  });

  /* ---------------------- visibility filtering ------------------------- */
  test('getTournamentsWithGameInfo excludes hidden by default, supports hidden/all', () => {
    seedTournament({ id: 'tv-vis', gameId: GAME, status: 'open', createdBy: ADMIN });
    seedTournament({ id: 'tv-hid', gameId: GAME, status: 'open', createdBy: ADMIN });
    setTournamentHidden('tv-hid', true, ADMIN);

    const visible = getTournamentsWithGameInfo().map((t) => t.id);
    assertTrue(visible.includes('tv-vis'), 'visible listed');
    assertTrue(!visible.includes('tv-hid'), 'hidden excluded by default');

    const hidden = getTournamentsWithGameInfo({ visibility: 'hidden' }).map((t) => t.id);
    assertTrue(hidden.includes('tv-hid'), 'hidden view includes hidden');
    assertTrue(!hidden.includes('tv-vis'), 'hidden view excludes visible');

    const all = getTournamentsWithGameInfo({ visibility: 'all' }).map((t) => t.id);
    assertTrue(all.includes('tv-vis') && all.includes('tv-hid'), 'all includes both');
  });

  test('getTournamentsByGame excludes hidden by default', () => {
    seedTournament({ id: 'tv-bygame-vis', gameId: GAME, status: 'open', createdBy: ADMIN });
    seedTournament({ id: 'tv-bygame-hid', gameId: GAME, status: 'open', createdBy: ADMIN });
    setTournamentHidden('tv-bygame-hid', true, ADMIN);

    const visible = getTournamentsByGame(GAME).map((t) => t.id);
    assertTrue(visible.includes('tv-bygame-vis'), 'visible game tournament listed');
    assertTrue(!visible.includes('tv-bygame-hid'), 'hidden game tournament excluded');
  });

  /* ------------------- detail accessibility + history ------------------ */
  test('hidden tournament detail stays accessible with a hidden marker', () => {
    const id = 'tv-detail';
    seedTournament({ id, gameId: GAME, status: 'completed', createdBy: ADMIN });
    setTournamentHidden(id, true, ADMIN);

    const summary = getTournamentSummary(id);
    assertTrue(!!summary, 'summary accessible while hidden');
    assertEqual(summary!.hidden, true, 'hidden marker exposed');
    assertEqual(summary!.status, 'completed', 'lifecycle status unchanged');
  });

  test('hidden tournaments remain in player competitive history', () => {
    const id = 'tv-history';
    seedTournament({ id, gameId: GAME, status: 'open', createdBy: ADMIN });
    seedPlayer('tv-history-p');
    seedTournamentParticipant(id, 'tv-history-p');
    setTournamentHidden(id, true, ADMIN);

    const states = getPlayerTournaments('tv-history-p');
    assertTrue(states.some((s) => s.tournamentId === id), 'hidden tournament retained in history');
  });

  /* ---------------------------- purchase block ------------------------- */
  await testAsync('purchase: a hidden open tournament is blocked (tournament_hidden)', async () => {
    seedSession(USER.id, 'user');
    const id = 'tv-purchase';
    seedTournament({ id, gameId: GAME, status: 'open', createdBy: ADMIN });
    seedLinkedGuest('tv-buyer', CHANNEL, USER.id);
    setTournamentHidden(id, true, ADMIN);

    let code: string | null = null;
    try {
      await startPurchase(USER, id, GAME);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'tournament_hidden', 'new purchase blocked while hidden');
  });

  /* ------------------------------ admin API ---------------------------- */
  api = await startTestApi();
  try {
    await testAsync('admin API: default list excludes hidden; hidden/all views and PATCH toggle', async () => {
      const made = await admin('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'API Visibility', status: 'open' },
      });
      assertEqual(made.status, 201, 'created');
      const id = made.body.tournament.id;

      const hide = await admin(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { hidden: true } });
      assertEqual(hide.status, 200, 'hide status');
      assertTrue(hide.body.tournament.hidden_at !== null, 'hidden_at set');
      assertEqual(hide.body.tournament.status, 'open', 'status untouched');

      const def = await admin('/api/admin/tournaments');
      assertTrue(!(def.body.tournaments as any[]).some((t) => t.id === id), 'excluded from default admin list');

      const hiddenList = await admin('/api/admin/tournaments?visibility=hidden');
      assertTrue((hiddenList.body.tournaments as any[]).some((t) => t.id === id), 'present in hidden view');

      const allList = await admin('/api/admin/tournaments?visibility=all');
      assertTrue((allList.body.tournaments as any[]).some((t) => t.id === id), 'present in all view');

      const bad = await admin('/api/admin/tournaments?visibility=bogus');
      assertEqual(bad.status, 400, 'invalid visibility rejected');

      const restore = await admin(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { hidden: false } });
      assertEqual(restore.status, 200, 'restore status');
      assertNull(restore.body.tournament.hidden_at, 'restored visible');
      assertEqual(restore.body.tournament.status, 'open', 'status still open');

      const def2 = await admin('/api/admin/tournaments');
      assertTrue((def2.body.tournaments as any[]).some((t) => t.id === id), 'restored to default list');
    });

    await testAsync('admin API: PATCH hidden must be boolean', async () => {
      const made = await admin('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'API Bad Hidden', status: 'open' },
      });
      const id = made.body.tournament.id;
      const res = await admin(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { hidden: 'yes' } });
      assertEqual(res.status, 400, 'non-boolean rejected');
      assertEqual(res.body.error, 'invalid_hidden', 'error code');
    });

    await testAsync('public API: hidden excluded from list/game list, detail accessible with marker', async () => {
      const made = await admin('/api/admin/tournaments', {
        method: 'POST',
        body: { game_id: GAME, name_ar: 'Public Visibility', status: 'open' },
      });
      const id = made.body.tournament.id;
      await admin(`/api/admin/tournaments/${id}`, { method: 'PATCH', body: { hidden: true } });

      const list = await publicReq('/api/tournaments');
      assertTrue(!(list.body.tournaments as any[]).some((t) => t.id === id), 'excluded from public list');

      const gameList = await publicReq(`/api/games/${GAME}/tournaments`);
      assertTrue(!(gameList.body.tournaments as any[]).some((t) => t.id === id), 'excluded from game list');

      const detail = await publicReq(`/api/tournaments/${id}`);
      assertEqual(detail.status, 200, 'detail accessible');
      assertTrue(detail.body.tournament.hidden_at !== null, 'hidden marker on detail');

      const summary = await publicReq(`/api/tournaments/${id}/summary`);
      assertEqual(summary.status, 200, 'competitive summary accessible');
      assertEqual(summary.body.tournament.hidden, true, 'hidden flag on summary');
    });
  } finally {
    await api.close();
  }

  cleanupTestDb();
  summarize('TournamentVisibility');
}

main().catch((err) => {
  console.error('TournamentVisibility suite crashed:', err);
  process.exit(1);
});
