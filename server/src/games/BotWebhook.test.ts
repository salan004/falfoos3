/**
 * Phase 3D — bot purchase-event webhook integration tests.
 *
 * Exercises the REAL Express route, HMAC middleware, tournament/participant
 * services and SQLite database against the DEPLOYED bot contract:
 *
 * {
 *   "event_id": "evt_<transaction_id>",
 *   "event_type": "ticket_purchase",
 *   "payload": { "tournament_id", "game_id", "youtube_channel_id", "youtube_name", "transaction_id" }
 * }
 *
 * Run: `ts-node src/games/BotWebhook.test.ts` (wired into `npm run test`).
 */

import { TEST_BOT_WEBHOOK_SECRET } from './botWebhookTestDb';
import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { cleanupTestDb, testDbPath } from '../competitive/testDb';
import { getDb, initDatabase } from '../db/db';
import { seedGame, seedUser, seedTournament } from '../competitive/competitiveTestSeed';
import { botRoutes } from '../routes/botRoutes';
import { captureRawBody } from '../middleware/verifyBotWebhook';
import { assertEqual, assertNull, assertTrue, summarize, testAsync } from '../competitive/testHarness';

const GAME = 'bot-game-1';
const OTHER_GAME = 'bot-game-2';
const ADMIN = 'bot-admin-1';
const CHANNEL = 'UC_bot_test_channel_1';
const UNKNOWN_CHANNEL = 'UC_bot_unknown_channel';
const PLAYER = 'bot-player-1';
const TOURNAMENT = 'bot-tournament-1';

let server: http.Server;
let baseUrl = '';

function sign(raw: string, timestamp: number): string {
  return crypto
    .createHmac('sha256', TEST_BOT_WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest('hex');
}

async function startApi(): Promise<void> {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.use('/api/v1/bot', botRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}

interface PostResult {
  status: number;
  body: any;
}

async function postEvent(
  payload: unknown,
  opts: { idempotencyKey?: string; badSignature?: boolean; timestamp?: number } = {}
): Promise<PostResult> {
  const raw = JSON.stringify(payload);
  // Match the deployed bot's contract: X-FalFoos-Signature timestamp is Unix seconds.
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = opts.badSignature ? 'deadbeef' : sign(raw, timestamp);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-FalFoos-Signature': `t=${timestamp},v1=${signature}`,
  };
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${baseUrl}/api/v1/bot/purchase-event`, {
    method: 'POST',
    headers,
    body: raw,
  });
  const text = await res.text();
  let body: any = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

/** Builds the deployed bot contract; tests may mutate/delete fields as needed. */
function ticketPayload(opts: {
  eventId?: string;
  eventType?: string;
  channelId?: string;
  tournamentId?: string;
  gameId?: string;
  includePayload?: boolean;
} = {}): Record<string, unknown> {
  const eventId = opts.eventId ?? 'evt_default';
  const body: Record<string, unknown> = {
    event_id: eventId,
    event_type: opts.eventType ?? 'ticket_purchase',
  };
  if (opts.includePayload !== false) {
    body.payload = {
      tournament_id: opts.tournamentId ?? TOURNAMENT,
      game_id: opts.gameId ?? GAME,
      youtube_channel_id: opts.channelId ?? CHANNEL,
      youtube_name: 'Test Channel',
      transaction_id: `tx-${eventId}`,
    };
  }
  return body;
}

function seedYouTubePlayer(playerId: string, channelId: string, name = 'YT Player'): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO guests (player_id, display_name, avatar_url, first_seen, last_seen, youtube_channel_id)
       VALUES (?, ?, NULL, ?, ?, ?)`
    )
    .run(playerId, name, now, now, channelId);
}

function reset(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
    db.prepare('DELETE FROM bot_webhook_events').run();
  })();
}

function participantCount(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tournament_participants')
    .get() as { n: number };
  return row.n;
}

function eventStatus(eventId: string): string | null {
  const row = getDb()
    .prepare('SELECT status FROM bot_webhook_events WHERE event_id = ?')
    .get(eventId) as { status: string } | undefined;
  return row?.status ?? null;
}

function openTournament(): void {
  seedTournament({ id: TOURNAMENT, gameId: GAME, status: 'open', createdBy: ADMIN, maxParticipants: 100 });
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');

  seedUser(ADMIN);
  seedGame(GAME, 'bot-game-slug');
  seedGame(OTHER_GAME, 'bot-game-slug-2');
  seedYouTubePlayer(PLAYER, CHANNEL, 'Linked YouTube Player');

  await startApi();

  await testAsync('Test 1 — valid ticket_purchase reaches tournament validation and registers', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_valid_1' }), { idempotencyKey: 'evt_valid_1' });
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    const participant = getDb()
      .prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND player_id = ?')
      .get(TOURNAMENT, PLAYER) as any;
    assertTrue(!!participant, 'participant row exists');
    assertEqual(participant.source, 'purchase', 'source');
    assertEqual(participant.ticket_ref, 'evt_valid_1', 'ticket_ref = event_id');
    assertEqual(eventStatus('evt_valid_1'), 'success', 'event marked success');
  });

  await testAsync('Test 2 — missing event_id returns 400', async () => {
    reset();
    openTournament();
    const body = ticketPayload({ eventId: 'evt_missing_id_1' });
    delete body.event_id;
    const res = await postEvent(body, { idempotencyKey: 'evt_missing_id_1' });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'invalid_event_id', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 3 — wrong event_type returns 400 (old contract not accepted)', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_wrong_type_1', eventType: 'purchase.completed' }), {
      idempotencyKey: 'evt_wrong_type_1',
    });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'unsupported_event_type', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 4 — missing payload returns 400', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_no_payload_1', includePayload: false }), {
      idempotencyKey: 'evt_no_payload_1',
    });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'missing_payload', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 5 — missing payload.tournament_id returns 400', async () => {
    reset();
    openTournament();
    const body = ticketPayload({ eventId: 'evt_missing_tour_1' });
    delete (body.payload as Record<string, unknown>).tournament_id;
    const res = await postEvent(body, { idempotencyKey: 'evt_missing_tour_1' });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'missing_tournament_id', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 6 — missing payload.game_id returns 400', async () => {
    reset();
    openTournament();
    const body = ticketPayload({ eventId: 'evt_missing_game_1' });
    delete (body.payload as Record<string, unknown>).game_id;
    const res = await postEvent(body, { idempotencyKey: 'evt_missing_game_1' });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'missing_game_id', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 7 — missing payload.youtube_channel_id returns 400', async () => {
    reset();
    openTournament();
    const body = ticketPayload({ eventId: 'evt_missing_channel_1' });
    delete (body.payload as Record<string, unknown>).youtube_channel_id;
    const res = await postEvent(body, { idempotencyKey: 'evt_missing_channel_1' });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'missing_youtube_channel_id', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 8 — unknown tournament returns 404 and is not marked success', async () => {
    reset();
    const res = await postEvent(ticketPayload({ eventId: 'evt_notour_1', tournamentId: 'does-not-exist' }), {
      idempotencyKey: 'evt_notour_1',
    });
    assertEqual(res.status, 404, 'http status');
    assertEqual(res.body.error, 'tournament_not_found', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertEqual(eventStatus('evt_notour_1'), 'error', 'failed delivery recorded as error (retryable)');
  });

  await testAsync('Test 9 — game mismatch returns 409 and is not marked success', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_game_1', gameId: OTHER_GAME }), {
      idempotencyKey: 'evt_game_1',
    });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'game_mismatch', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertTrue(eventStatus('evt_game_1') !== 'success', 'event not marked success');
  });

  await testAsync('Test 10 — tournament not open returns 409 and is not marked success', async () => {
    reset();
    seedTournament({ id: TOURNAMENT, gameId: GAME, status: 'draft', createdBy: ADMIN });
    const res = await postEvent(ticketPayload({ eventId: 'evt_closed_1' }), { idempotencyKey: 'evt_closed_1' });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'tournament_not_open', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertTrue(eventStatus('evt_closed_1') !== 'success', 'event not marked success');
  });

  await testAsync('Test 11 — unknown YouTube player returns 404 and is not marked success', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_unknown_1', channelId: UNKNOWN_CHANNEL }), {
      idempotencyKey: 'evt_unknown_1',
    });
    assertEqual(res.status, 404, 'http status');
    assertEqual(res.body.error, 'unknown_youtube_player', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertTrue(eventStatus('evt_unknown_1') !== 'success', 'event not marked success');
  });

  await testAsync('Test 12 — duplicate event is idempotent (one participant)', async () => {
    reset();
    openTournament();
    const first = await postEvent(ticketPayload({ eventId: 'evt_dup_1' }), { idempotencyKey: 'evt_dup_1' });
    const second = await postEvent(ticketPayload({ eventId: 'evt_dup_1' }), { idempotencyKey: 'evt_dup_1' });
    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 200, 'second status');
    assertEqual(second.body.idempotent, true, 'second is idempotent');
    assertEqual(participantCount(), 1, 'only one participant');
    assertEqual(eventStatus('evt_dup_1'), 'success', 'event marked success');
  });

  await testAsync('Test 13 — duplicate player with a different event is blocked (one participant)', async () => {
    reset();
    openTournament();
    const first = await postEvent(ticketPayload({ eventId: 'evt_a' }), { idempotencyKey: 'evt_a' });
    const second = await postEvent(ticketPayload({ eventId: 'evt_b' }), { idempotencyKey: 'evt_b' });
    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 409, 'second status');
    assertEqual(participantCount(), 1, 'still only one participant');
  });

  await testAsync('Test 14 — failed delivery is never recorded as successful', async () => {
    reset();
    openTournament();
    const gameMismatch = await postEvent(ticketPayload({ eventId: 'evt_fail_game', gameId: OTHER_GAME }), {
      idempotencyKey: 'evt_fail_game',
    });
    const unknownPlayer = await postEvent(ticketPayload({ eventId: 'evt_fail_player', channelId: UNKNOWN_CHANNEL }), {
      idempotencyKey: 'evt_fail_player',
    });
    assertEqual(gameMismatch.status, 409, 'game mismatch status');
    assertEqual(unknownPlayer.status, 404, 'unknown player status');
    assertEqual(eventStatus('evt_fail_game'), 'error', 'game mismatch recorded as error');
    assertEqual(eventStatus('evt_fail_player'), 'error', 'unknown player recorded as error');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 15 — invalid HMAC returns 401 with no database changes', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_badsig_1' }), {
      idempotencyKey: 'evt_badsig_1',
      badSignature: true,
    });
    assertEqual(res.status, 401, 'http status');
    assertEqual(res.body.error, 'invalid_signature', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertNull(eventStatus('evt_badsig_1'), 'no event row written');
  });

  await testAsync('Test 16 — Unix-seconds timestamp (within window) is accepted', async () => {
    reset();
    openTournament();
    const oneMinuteAgoSeconds = Math.floor(Date.now() / 1000) - 60;
    const res = await postEvent(ticketPayload({ eventId: 'evt_seconds_ok_1' }), {
      idempotencyKey: 'evt_seconds_ok_1',
      timestamp: oneMinuteAgoSeconds,
    });
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    assertEqual(participantCount(), 1, 'participant created');
  });

  await testAsync('Test 17 — Unix-seconds timestamp outside 5-minute window is rejected', async () => {
    reset();
    openTournament();
    const tenMinutesAgoSeconds = Math.floor(Date.now() / 1000) - 600;
    const res = await postEvent(ticketPayload({ eventId: 'evt_stale_1' }), {
      idempotencyKey: 'evt_stale_1',
      timestamp: tenMinutesAgoSeconds,
    });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'stale_timestamp', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 18 — milliseconds timestamp is rejected as stale (contract is seconds)', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_ms_1' }), {
      idempotencyKey: 'evt_ms_1',
      timestamp: Date.now(),
    });
    assertEqual(res.status, 400, 'http status');
    assertEqual(res.body.error, 'stale_timestamp', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  cleanupTestDb();
  summarize('BotWebhook');
}

main().catch((err) => {
  console.error('BotWebhook test suite crashed:', err);
  process.exit(1);
});
