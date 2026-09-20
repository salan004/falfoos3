/**
 * Phase 3D/3E — bot purchase-event webhook integration tests.
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
 * Includes Phase 3E auto-Guest creation for channels not yet in `guests`.
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
const PLAYER = 'bot-player-1';
const TOURNAMENT = 'bot-tournament-1';
const TOURNAMENT_2 = 'bot-tournament-2';

let server: http.Server;
let baseUrl = '';

/* --- Mocked YouTube Data API (channels) for avatar enrichment tests --- */
const realFetch = globalThis.fetch.bind(globalThis);
let youtubeCalls = 0;
let youtubeMock: { ok: boolean; json?: () => Promise<unknown>; throws?: Error } = {
  ok: true,
  json: async () => ({
    items: [{ snippet: { thumbnails: { high: { url: 'https://yt.example/high.jpg' } } } }],
  }),
};

function installYouTubeFetchMock(): void {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('googleapis.com/youtube/v3/channels')) {
      youtubeCalls += 1;
      if (youtubeMock.throws) throw youtubeMock.throws;
      return {
        ok: youtubeMock.ok,
        status: youtubeMock.ok ? 200 : 500,
        json: youtubeMock.json ?? (async () => ({})),
      } as any;
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

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
  youtubeName?: string;
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
      youtube_name: opts.youtubeName ?? 'Test Channel',
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

function seedClaimedYouTubePlayer(
  playerId: string,
  channelId: string,
  claimerUserId: string,
  name = 'Claimed Player'
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO guests
         (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(playerId, name, now, now, claimerUserId, channelId);
}

/** Clears all test state and re-seeds the canonical known player. */
function reset(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
    db.prepare('DELETE FROM bot_webhook_events').run();
    db.prepare('DELETE FROM website_purchase_intents').run();
    db.prepare('DELETE FROM guests').run();
  })();
  seedYouTubePlayer(PLAYER, CHANNEL, 'Linked YouTube Player');
}

function participantCount(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM tournament_participants')
    .get() as { n: number };
  return row.n;
}

function guestRowByChannel(channelId: string): any {
  const row = getDb()
    .prepare('SELECT * FROM guests WHERE youtube_channel_id = ?')
    .get(channelId);
  return row ?? null;
}

function guestCountForChannel(channelId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM guests WHERE youtube_channel_id = ?')
    .get(channelId) as { n: number };
  return row.n;
}

function tournamentParticipantCount(tournamentId: string): number {
  const row = getDb()
    .prepare('SELECT participant_count FROM tournaments WHERE id = ?')
    .get(tournamentId) as { participant_count: number } | undefined;
  return row?.participant_count ?? 0;
}

function eventStatus(eventId: string): string | null {
  const row = getDb()
    .prepare('SELECT status FROM bot_webhook_events WHERE event_id = ?')
    .get(eventId) as { status: string } | undefined;
  return row?.status ?? null;
}

function getParticipantRow(tournamentId: string, playerId: string): any {
  return getDb()
    .prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND player_id = ?')
    .get(tournamentId, playerId);
}

function openTournament(): void {
  seedTournament({ id: TOURNAMENT, gameId: GAME, status: 'open', createdBy: ADMIN, maxParticipants: 100 });
}

/**
 * Seeds a `website_purchase_intents` row so the F5 refund guard can correlate
 * the incoming `event_id` (= `ticket_event_id`) with a Website purchase.
 */
function seedPurchaseIntent(opts: {
  requestId: string;
  ticketEventId: string | null;
  status:
    | 'INTENT_CREATED'
    | 'BOT_REQUESTED'
    | 'BOT_DEBIT_CONFIRMED'
    | 'PARTICIPANT_REGISTERED'
    | 'FAILED'
    | 'REFUND_REQUESTED'
    | 'REFUNDED'
    | 'PENDING_RECOVERY';
  tournamentId?: string;
  gameId?: string;
  channelId?: string;
  botTxId?: string | null;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO website_purchase_intents
         (request_id, website_user_id, player_id, youtube_channel_id, tournament_id, game_id,
          status, bot_tx_id, ticket_event_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.requestId,
      'bot-site-user-1',
      PLAYER,
      opts.channelId ?? CHANNEL,
      opts.tournamentId ?? TOURNAMENT,
      opts.gameId ?? GAME,
      opts.status,
      opts.botTxId ?? null,
      opts.ticketEventId,
      now,
      now
    );
}

async function main(): Promise<void> {
  initDatabase();
  assertEqual(getDb().name, testDbPath, 'isolated test database is active');

  seedUser(ADMIN);
  seedGame(GAME, 'bot-game-slug');
  seedGame(OTHER_GAME, 'bot-game-slug-2');
  seedYouTubePlayer(PLAYER, CHANNEL, 'Linked YouTube Player');

  await startApi();
  installYouTubeFetchMock();

  await testAsync('Test 1 — existing Guest is reused and participant registers', async () => {
    reset();
    openTournament();
    const res = await postEvent(ticketPayload({ eventId: 'evt_valid_1' }), { idempotencyKey: 'evt_valid_1' });
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    assertEqual(guestCountForChannel(CHANNEL), 1, 'no duplicate Guest');
    const participant = getParticipantRow(TOURNAMENT, PLAYER);
    assertTrue(!!participant, 'participant row exists for existing player');
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

  await testAsync('Test 11 — new YouTube channel creates an unclaimed Guest and registers', async () => {
    reset();
    openTournament();
    const newChannel = 'UC_bot_brand_new_channel';
    const res = await postEvent(
      ticketPayload({ eventId: 'evt_new_guest_1', channelId: newChannel, youtubeName: 'Brand New Player' }),
      { idempotencyKey: 'evt_new_guest_1' }
    );
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    const guest = guestRowByChannel(newChannel);
    assertTrue(!!guest, 'guest row created');
    assertNull(guest.claimed_user_id, 'claimed_user_id is NULL');
    assertEqual(guest.youtube_channel_id, newChannel, 'youtube_channel_id stored correctly');
    assertEqual(guest.display_name, 'Brand New Player', 'display_name = youtube_name');
    const participant = getParticipantRow(TOURNAMENT, guest.player_id);
    assertTrue(!!participant, 'participant registered with new player_id');
    assertEqual(participant.ticket_ref, 'evt_new_guest_1', 'ticket_ref = event_id');
    assertEqual(participant.source, 'purchase', 'source');
  });

  await testAsync('Test 12 — existing claimed Guest is reused and claim is untouched', async () => {
    reset();
    openTournament();
    const claimedChannel = 'UC_bot_claimed_channel';
    seedClaimedYouTubePlayer('bot-claimed-player', claimedChannel, ADMIN, 'Claimed Player');
    const res = await postEvent(
      ticketPayload({ eventId: 'evt_claimed_1', channelId: claimedChannel }),
      { idempotencyKey: 'evt_claimed_1' }
    );
    assertEqual(res.status, 200, 'http status');
    const guest = guestRowByChannel(claimedChannel);
    assertEqual(guest.player_id, 'bot-claimed-player', 'same Guest reused');
    assertEqual(guest.claimed_user_id, ADMIN, 'claimed_user_id unchanged');
    const participant = getParticipantRow(TOURNAMENT, 'bot-claimed-player');
    assertTrue(!!participant, 'participant registered');
  });

  await testAsync('Test 13 — duplicate delivery for a new channel: one Guest, one participant', async () => {
    reset();
    openTournament();
    const newChannel = 'UC_bot_dup_new_channel';
    const first = await postEvent(ticketPayload({ eventId: 'evt_newdup_1', channelId: newChannel }), {
      idempotencyKey: 'evt_newdup_1',
    });
    const second = await postEvent(ticketPayload({ eventId: 'evt_newdup_1', channelId: newChannel }), {
      idempotencyKey: 'evt_newdup_1',
    });
    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 200, 'second status');
    assertEqual(second.body.idempotent, true, 'second is idempotent');
    assertEqual(guestCountForChannel(newChannel), 1, 'only one Guest');
    assertEqual(participantCount(), 1, 'only one participant');
    assertEqual(tournamentParticipantCount(TOURNAMENT), 1, 'participant_count incremented once');
  });

  await testAsync('Test 14 — different events for the same new channel reuse one Guest', async () => {
    reset();
    openTournament();
    const newChannel = 'UC_bot_same_channel_two_events';
    const first = await postEvent(ticketPayload({ eventId: 'evt_same_a', channelId: newChannel }), {
      idempotencyKey: 'evt_same_a',
    });
    const second = await postEvent(ticketPayload({ eventId: 'evt_same_b', channelId: newChannel }), {
      idempotencyKey: 'evt_same_b',
    });
    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 409, 'second status (different purchase, same player)');
    assertEqual(guestCountForChannel(newChannel), 1, 'only one Guest for the channel');
    assertEqual(participantCount(), 1, 'only one participant');
  });

  await testAsync('Test 15 — full tournament rolls back the newly created Guest', async () => {
    reset();
    seedTournament({ id: TOURNAMENT, gameId: GAME, status: 'open', createdBy: ADMIN, maxParticipants: 1 });
    getDb().prepare('UPDATE tournaments SET participant_count = 1 WHERE id = ?').run(TOURNAMENT);
    const newChannel = 'UC_bot_full_channel';
    const res = await postEvent(ticketPayload({ eventId: 'evt_full_1', channelId: newChannel }), {
      idempotencyKey: 'evt_full_1',
    });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'tournament_full', 'error code');
    assertNull(guestRowByChannel(newChannel), 'newly created Guest rolled back');
    assertEqual(participantCount(), 0, 'no participant created');
    assertEqual(tournamentParticipantCount(TOURNAMENT), 1, 'participant_count unchanged');
    assertEqual(eventStatus('evt_full_1'), 'error', 'event recorded as error');
  });

  await testAsync('Test 16 — duplicate player with a different event is blocked (one participant)', async () => {
    reset();
    openTournament();
    const first = await postEvent(ticketPayload({ eventId: 'evt_a' }), { idempotencyKey: 'evt_a' });
    const second = await postEvent(ticketPayload({ eventId: 'evt_b' }), { idempotencyKey: 'evt_b' });
    assertEqual(first.status, 200, 'first status');
    assertEqual(second.status, 409, 'second status');
    assertEqual(participantCount(), 1, 'still only one participant');
  });

  await testAsync('Test 17 — failed delivery is never recorded as successful', async () => {
    reset();
    openTournament();
    const gameMismatch = await postEvent(ticketPayload({ eventId: 'evt_fail_game', gameId: OTHER_GAME }), {
      idempotencyKey: 'evt_fail_game',
    });
    const notFound = await postEvent(
      ticketPayload({ eventId: 'evt_fail_notour', tournamentId: 'does-not-exist' }),
      { idempotencyKey: 'evt_fail_notour' }
    );
    assertEqual(gameMismatch.status, 409, 'game mismatch status');
    assertEqual(notFound.status, 404, 'not found status');
    assertEqual(eventStatus('evt_fail_game'), 'error', 'game mismatch recorded as error');
    assertEqual(eventStatus('evt_fail_notour'), 'error', 'not found recorded as error');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 18 — invalid HMAC returns 401 with no database changes', async () => {
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

  await testAsync('Test 19 — Unix-seconds timestamp (within window) is accepted', async () => {
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

  await testAsync('Test 20 — Unix-seconds timestamp outside 5-minute window is rejected', async () => {
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

  await testAsync('Test 21 — milliseconds timestamp is rejected as stale (contract is seconds)', async () => {
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

  await testAsync('Test 22 — new Guest stores the YouTube channel thumbnail', async () => {
    reset();
    openTournament();
    const newChannel = 'UC_bot_avatar_ok';
    youtubeMock = {
      ok: true,
      json: async () => ({
        items: [{ snippet: { thumbnails: { default: { url: 'https://yt.example/d.jpg' }, high: { url: 'https://yt.example/high.jpg' } } } }],
      }),
    };
    const res = await postEvent(ticketPayload({ eventId: 'evt_avatar_ok', channelId: newChannel }), {
      idempotencyKey: 'evt_avatar_ok',
    });
    assertEqual(res.status, 200, 'http status');
    const guest = guestRowByChannel(newChannel);
    assertTrue(!!guest, 'guest created');
    assertEqual(guest.avatar_url, 'https://yt.example/high.jpg', 'avatar_url populated from YouTube');
    assertTrue(!!getParticipantRow(TOURNAMENT, guest.player_id), 'participant registered');
  });

  await testAsync('Test 23 — YouTube failure still registers the participant with NULL avatar', async () => {
    reset();
    openTournament();
    const newChannel = 'UC_bot_avatar_fail';
    youtubeMock = { ok: false };
    const res = await postEvent(ticketPayload({ eventId: 'evt_avatar_fail', channelId: newChannel }), {
      idempotencyKey: 'evt_avatar_fail',
    });
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'registration succeeded');
    const guest = guestRowByChannel(newChannel);
    assertTrue(!!guest, 'guest created');
    assertNull(guest.avatar_url, 'avatar_url NULL on failure');
    assertTrue(!!getParticipantRow(TOURNAMENT, guest.player_id), 'participant registered');
  });

  await testAsync('Test 24 — existing Guest does not trigger a YouTube fetch', async () => {
    reset();
    openTournament();
    const before = youtubeCalls;
    const res = await postEvent(ticketPayload({ eventId: 'evt_avatar_existing' }), {
      idempotencyKey: 'evt_avatar_existing',
    });
    assertEqual(res.status, 200, 'http status');
    assertEqual(youtubeCalls, before, 'no YouTube call for an existing Guest');
  });

  await testAsync('Test 25 — F5: REFUNDED intent blocks a delayed webhook', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-refunded-1',
      ticketEventId: 'evt_refunded_1',
      status: 'REFUNDED',
      botTxId: 'tx-evt_refunded_1',
    });
    const res = await postEvent(ticketPayload({ eventId: 'evt_refunded_1' }), {
      idempotencyKey: 'evt_refunded_1',
    });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'purchase_refunded', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
    assertEqual(eventStatus('evt_refunded_1'), 'error', 'event recorded as error');
  });

  await testAsync('Test 26 — F5: REFUND_REQUESTED intent blocks a delayed webhook', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-refund-req-1',
      ticketEventId: 'evt_refund_requested_1',
      status: 'REFUND_REQUESTED',
      botTxId: 'tx-evt_refund_requested_1',
    });
    const res = await postEvent(ticketPayload({ eventId: 'evt_refund_requested_1' }), {
      idempotencyKey: 'evt_refund_requested_1',
    });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'purchase_refund_requested', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 27 — F5: repeated refunded webhook stays blocked and idempotent', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-refunded-dup',
      ticketEventId: 'evt_refunded_dup',
      status: 'REFUNDED',
      botTxId: 'tx-evt_refunded_dup',
    });
    const first = await postEvent(ticketPayload({ eventId: 'evt_refunded_dup' }), {
      idempotencyKey: 'evt_refunded_dup',
    });
    const second = await postEvent(ticketPayload({ eventId: 'evt_refunded_dup' }), {
      idempotencyKey: 'evt_refunded_dup',
    });
    assertEqual(first.status, 409, 'first status');
    assertEqual(second.status, 409, 'second status');
    assertEqual(first.body.error, 'purchase_refunded', 'first error code');
    assertEqual(second.body.error, 'purchase_refunded', 'second error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 28 — F5: normal non-refunded Website intent still registers once', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-ok-1',
      ticketEventId: 'evt_ok_1',
      status: 'BOT_DEBIT_CONFIRMED',
      botTxId: 'tx-evt_ok_1',
    });
    const res = await postEvent(ticketPayload({ eventId: 'evt_ok_1' }), {
      idempotencyKey: 'evt_ok_1',
    });
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    assertEqual(participantCount(), 1, 'exactly one participant');
    const participant = getParticipantRow(TOURNAMENT, PLAYER);
    assertTrue(!!participant, 'participant row exists');
    assertEqual(participant.ticket_ref, 'evt_ok_1', 'ticket_ref = event_id');
  });

  await testAsync('Test 29 — F5: intent tournament mismatch is rejected', async () => {
    reset();
    openTournament();
    seedTournament({ id: TOURNAMENT_2, gameId: GAME, status: 'open', createdBy: ADMIN, maxParticipants: 100 });
    seedPurchaseIntent({
      requestId: 'req-mm-tour',
      ticketEventId: 'evt_mismatch_tour',
      status: 'BOT_DEBIT_CONFIRMED',
      tournamentId: TOURNAMENT,
      botTxId: 'tx-evt_mismatch_tour',
    });
    const res = await postEvent(
      ticketPayload({ eventId: 'evt_mismatch_tour', tournamentId: TOURNAMENT_2 }),
      { idempotencyKey: 'evt_mismatch_tour' }
    );
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'purchase_mismatch', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 30 — F5: intent channel mismatch is rejected', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-mm-channel',
      ticketEventId: 'evt_mismatch_channel',
      status: 'BOT_DEBIT_CONFIRMED',
      channelId: CHANNEL,
      botTxId: 'tx-evt_mismatch_channel',
    });
    const res = await postEvent(
      ticketPayload({ eventId: 'evt_mismatch_channel', channelId: 'UC_bot_other_channel' }),
      { idempotencyKey: 'evt_mismatch_channel' }
    );
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'purchase_mismatch', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 31 — F5: intent transaction mismatch is rejected', async () => {
    reset();
    openTournament();
    seedPurchaseIntent({
      requestId: 'req-mm-tx',
      ticketEventId: 'evt_mismatch_tx',
      status: 'BOT_DEBIT_CONFIRMED',
      botTxId: 'tx-expected',
    });
    const body = ticketPayload({ eventId: 'evt_mismatch_tx' });
    (body.payload as Record<string, unknown>).transaction_id = 'tx-different';
    const res = await postEvent(body, { idempotencyKey: 'evt_mismatch_tx' });
    assertEqual(res.status, 409, 'http status');
    assertEqual(res.body.error, 'purchase_mismatch', 'error code');
    assertEqual(participantCount(), 0, 'no participant created');
  });

  await testAsync('Test 32 — F5: event without a Website intent keeps legacy behavior', async () => {
    reset();
    openTournament();
    const legacyChannel = 'UC_bot_legacy_no_intent';
    const res = await postEvent(
      ticketPayload({ eventId: 'evt_no_intent_legacy', channelId: legacyChannel }),
      { idempotencyKey: 'evt_no_intent_legacy' }
    );
    assertEqual(res.status, 200, 'http status');
    assertEqual(res.body.success, true, 'success flag');
    const guest = guestRowByChannel(legacyChannel);
    assertTrue(!!guest, 'guest created');
    assertTrue(!!getParticipantRow(TOURNAMENT, guest.player_id), 'participant registered');
  });

  await new Promise<void>((resolve) => server.close(() => resolve()));
  cleanupTestDb();
  summarize('BotWebhook');
}

main().catch((err) => {
  console.error('BotWebhook test suite crashed:', err);
  process.exit(1);
});
