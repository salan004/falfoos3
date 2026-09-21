/**
 * R4.1 — website tournament ticket cost.
 *
 * Covers: migration 0027 (nullable column, legacy rows NULL), TournamentService
 * validation + create/update semantics, and public/admin API exposure.
 * Run: `npm -w server run test`.
 */

import { cleanupTestDb, testDbPath } from './testDb';
import { getDb, initDatabase } from '../db/db';
import { seedGame, seedSession, seedTournament } from './competitiveTestSeed';
import {
  createTournament,
  updateTournament,
  getTournamentById,
  getTournamentWithGameInfo,
  validateTicketCost,
  MAX_TICKET_COST,
} from '../games/TournamentService';
import { startTestApi, request, cookieFor, type TestApi } from './apiTestHarness';
import { assertEqual, assertNull, assertThrows, assertTrue, summarize, test, testAsync } from './testHarness';

const GAME = 'ttc-game';
const ADMIN = 'ttc-admin';

let api: TestApi;
let adminCookie: string;

function create(body: Record<string, unknown>) {
  return request<Record<string, any>>(api.baseUrl, '/api/admin/tournaments', {
    method: 'POST',
    cookie: adminCookie,
    body,
  });
}

function patch(id: string, body: Record<string, unknown>) {
  return request<Record<string, any>>(api.baseUrl, `/api/admin/tournaments/${id}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body,
  });
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');
  adminCookie = cookieFor(seedSession(ADMIN, 'admin'));
  seedGame(GAME, 'ttc-game');

  console.log('=== TournamentTicketCost ===');

  /* ----------------------------- migration ----------------------------- */
  test('migration 0027 adds a nullable, defaultless ticket_cost column', () => {
    const cols = getDb().prepare('PRAGMA table_info(tournaments)').all() as {
      name: string;
      notnull: number;
      dflt_value: unknown;
    }[];
    const col = cols.find((c) => c.name === 'ticket_cost');
    assertTrue(!!col, 'ticket_cost column exists');
    assertEqual(col!.notnull, 0, 'column is nullable');
    assertNull(col!.dflt_value, 'no default value');
  });

  test('existing tournaments remain valid with ticket_cost = NULL', () => {
    seedTournament({ id: 'ttc-legacy', gameId: GAME, createdBy: ADMIN });
    assertNull(getTournamentById('ttc-legacy')!.ticket_cost, 'legacy row is NULL');
  });

  /* -------------------------- service validation ----------------------- */
  test('validateTicketCost: null / undefined / empty -> NULL', () => {
    assertNull(validateTicketCost(null), 'null');
    assertNull(validateTicketCost(undefined), 'undefined');
    assertNull(validateTicketCost(''), 'empty string');
  });

  test('validateTicketCost: whole numbers >= 1 accepted', () => {
    assertEqual(validateTicketCost(1), 1, 'minimum');
    assertEqual(validateTicketCost(100), 100, 'typical');
    assertEqual(validateTicketCost(MAX_TICKET_COST), MAX_TICKET_COST, 'maximum');
    assertEqual(validateTicketCost('250'), 250, 'numeric string normalized');
  });

  test('validateTicketCost: 0 / negative / decimal / NaN / non-numeric / too large rejected', () => {
    assertThrows(() => validateTicketCost(0), 'zero');
    assertThrows(() => validateTicketCost(-5), 'negative');
    assertThrows(() => validateTicketCost(1.5), 'decimal');
    assertThrows(() => validateTicketCost(NaN), 'NaN');
    assertThrows(() => validateTicketCost('abc'), 'non-numeric string');
    assertThrows(() => validateTicketCost(MAX_TICKET_COST + 1), 'above maximum');
  });

  /* ---------------------- service create / update ---------------------- */
  test('createTournament stores a configured ticket_cost', () => {
    const t = createTournament({ game_id: GAME, name_ar: 'Paid Cup', ticket_cost: 120 }, ADMIN);
    assertEqual(t.ticket_cost, 120, 'returned value');
    assertEqual(getTournamentById(t.id)!.ticket_cost, 120, 'persisted value');
  });

  test('createTournament with omitted / null ticket_cost stores NULL', () => {
    const omitted = createTournament({ game_id: GAME, name_ar: 'Legacy Cup' }, ADMIN);
    assertNull(omitted.ticket_cost, 'omitted');
    const explicitNull = createTournament({ game_id: GAME, name_ar: 'Null Cup', ticket_cost: null }, ADMIN);
    assertNull(explicitNull.ticket_cost, 'explicit null');
  });

  test('createTournament rejects invalid ticket_cost', () => {
    assertThrows(() => createTournament({ game_id: GAME, name_ar: 'Bad Cup 0', ticket_cost: 0 }, ADMIN), 'zero');
    assertThrows(() => createTournament({ game_id: GAME, name_ar: 'Bad Cup neg', ticket_cost: -1 }, ADMIN), 'negative');
    assertThrows(() => createTournament({ game_id: GAME, name_ar: 'Bad Cup dec', ticket_cost: 2.5 }, ADMIN), 'decimal');
  });

  test('updateTournament sets, clears, re-sets and preserves ticket_cost', () => {
    const t = createTournament({ game_id: GAME, name_ar: 'Update Cup', ticket_cost: 50 }, ADMIN);
    assertEqual(updateTournament(t.id, { ticket_cost: 75 }).ticket_cost, 75, 'set');
    assertNull(updateTournament(t.id, { ticket_cost: null }).ticket_cost, 'cleared');
    assertEqual(updateTournament(t.id, { ticket_cost: 90 }).ticket_cost, 90, 're-set');
    assertEqual(
      updateTournament(t.id, { name_ar: 'Update Cup Renamed' }).ticket_cost,
      90,
      'preserved when omitted'
    );
  });

  test('updateTournament rejects invalid ticket_cost', () => {
    const t = createTournament({ game_id: GAME, name_ar: 'Update Bad Cup' }, ADMIN);
    assertThrows(() => updateTournament(t.id, { ticket_cost: 0 }), 'zero');
    assertThrows(() => updateTournament(t.id, { ticket_cost: -1 }), 'negative');
    assertThrows(() => updateTournament(t.id, { ticket_cost: 1.25 }), 'decimal');
  });

  test('public projection exposes ticket_cost', () => {
    const t = createTournament({ game_id: GAME, name_ar: 'Projection Cup', ticket_cost: 42 }, ADMIN);
    assertEqual(getTournamentWithGameInfo(t.id)!.ticket_cost, 42, 'with-game projection');
  });

  /* ------------------------------ admin API ---------------------------- */
  api = await startTestApi();
  try {
    await testAsync('admin API: create with ticket_cost', async () => {
      const res = await create({ game_id: GAME, name_ar: 'API Paid', ticket_cost: 300 });
      assertEqual(res.status, 201, 'status');
      assertEqual(res.body.tournament.ticket_cost, 300, 'stored');
    });

    await testAsync('admin API: update then clear ticket_cost to NULL', async () => {
      const made = await create({ game_id: GAME, name_ar: 'API Edit', ticket_cost: 10 });
      const id = made.body.tournament.id;
      const updated = await patch(id, { ticket_cost: 250 });
      assertEqual(updated.status, 200, 'update status');
      assertEqual(updated.body.tournament.ticket_cost, 250, 'updated');
      const cleared = await patch(id, { ticket_cost: null });
      assertEqual(cleared.status, 200, 'clear status');
      assertNull(cleared.body.tournament.ticket_cost, 'cleared to NULL');
    });

    await testAsync('admin API: omitted ticket_cost preserves the stored value', async () => {
      const made = await create({ game_id: GAME, name_ar: 'API Keep', ticket_cost: 500 });
      const id = made.body.tournament.id;
      const updated = await patch(id, { name_ar: 'API Keep Renamed' });
      assertEqual(updated.status, 200, 'status');
      assertEqual(updated.body.tournament.ticket_cost, 500, 'backward compatible');
    });

    await testAsync('admin API: invalid ticket_cost is rejected (400)', async () => {
      const res = await create({ game_id: GAME, name_ar: 'API Bad', ticket_cost: 0 });
      assertEqual(res.status, 400, 'status');
    });

    await testAsync('public API: list and detail expose ticket_cost', async () => {
      const made = await create({ game_id: GAME, name_ar: 'API Public', ticket_cost: 77, status: 'open' });
      const id = made.body.tournament.id;
      const list = await request<Record<string, any>>(api.baseUrl, '/api/tournaments');
      const found = (list.body.tournaments as any[]).find((t) => t.id === id);
      assertEqual(found?.ticket_cost, 77, 'list value');
      const detail = await request<Record<string, any>>(api.baseUrl, `/api/tournaments/${id}`);
      assertEqual(detail.body.tournament.ticket_cost, 77, 'detail value');
    });
  } finally {
    await api.close();
  }

  cleanupTestDb();
  summarize('TournamentTicketCost');
}

main().catch((err) => {
  console.error('TournamentTicketCost suite crashed:', err);
  process.exit(1);
});
