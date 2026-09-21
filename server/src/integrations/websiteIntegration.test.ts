import './integrationTestDb';
import crypto from 'crypto';
import http from 'http';
import express from 'express';
import { initDatabase, getDb } from '../db/db';
import { TEST_SECRET, cleanupTestDb } from './integrationTestDb';
import { test, testAsync, assertEqual, assertTrue, assertNull, summarize } from '../competitive/testHarness';
import { ensureUserCanonicalPlayer, resolveSocketIdentity } from '../auth/socketIdentity';
import { findCanonicalPlayerIdByChannel, findLinkedPlayerForUser } from '../identity/identityService';
import { startLink, verifyLink, isClaimOwnershipConflict } from './linkService';
import { callBot, BOT_ENDPOINTS, health, BotIntegrationError } from './falfoosBotClient';
import { startPurchase, recoverPurchaseIntents } from './purchaseService';
import { IntegrationError } from './errors';
import { installBotMock, restoreFetch, type BotMockState } from './websiteTestBotMock';
import { websiteIntegrationRoutes } from './websiteIntegrationRoutes';
import { websiteTournamentRoutes } from './websiteTournamentRoutes';
import { captureRawBody } from '../middleware/verifyBotWebhook';
import type { SessionUser } from '../auth/session';

/**
 * Phase 7 — website <-> bot integration tests.
 *
 * The bot is simulated in-process (signed requests + signed responses) so the
 * real HMAC/response-verification code paths are exercised. No network.
 */

const USER: SessionUser = { id: 'user-1', displayName: 'Website User', role: 'user' };
const USER2: SessionUser = { id: 'user-2', displayName: 'Other User', role: 'user' };
const ADMIN = 'admin-user';
const GAME = 'game-1';
const TOURNEY = 'tourney-1';
const TEN_MIN = 10 * 60 * 1000;

const CHANNEL = 'UC' + 'a'.repeat(22);
const CHANNEL2 = 'UC' + 'b'.repeat(22);
const PLAYER = 'player-1';
const PLAYER2 = 'player-2';

let bot: BotMockState;

function reset(): void {
  const db = getDb();
  for (const table of [
    'match_result_corrections',
    'tournament_match_participants',
    'tournament_matches',
    'competitive_xp_transactions',
    'competitive_progressions',
    'elo_transactions',
    'lp_transactions',
    'competitive_profiles',
    'score_events',
    'participations',
    'match_winners',
    'player_achievements',
    'matches',
    'website_purchase_intents',
    'link_intents',
    'tournament_participants',
    'tournaments',
    'games',
    'sessions',
    'guests',
    'users',
    'bot_webhook_events',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

function seedUser(id: string, role = 'user'): void {
  getDb()
    .prepare('INSERT INTO users (id, display_name, role, created_at) VALUES (?, ?, ?, ?)')
    .run(id, id, role, Date.now());
}

function seedGame(id = GAME): void {
  getDb()
    .prepare(
      'INSERT INTO games (id, slug, name_ar, is_active, sort_order, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)'
    )
    .run(id, id + '-slug', id, Date.now(), Date.now());
}

function seedTournament(id = TOURNEY, max: number | null = 100, count = 0, status = 'open'): void {
  getDb()
    .prepare(
      `INSERT INTO tournaments
         (id, game_id, name_ar, status, max_participants, participant_count, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, GAME, id, status, max, count, ADMIN, Date.now(), Date.now());
}

/** R4.1 — sets the configured website ticket cost on a seeded tournament. */
function setTicketCost(tournamentId: string, cost: number | null): void {
  getDb().prepare('UPDATE tournaments SET ticket_cost = ? WHERE id = ?').run(cost, tournamentId);
}

function seedGuest(playerId: string, channel: string | null, claimedUserId: string | null = null): void {
  getDb()
    .prepare(
      `INSERT INTO guests (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
       VALUES (?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(playerId, playerId, Date.now(), Date.now(), claimedUserId, channel);
}

function seedSession(sid: string, userId: string): void {
  const now = Date.now();
  getDb()
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sid, userId, now, now + 60 * 60 * 1000);
}

/* --- Step 5F (F3): real HTTP harness for the admin-gated recovery route --- */
let recoverApiServer: http.Server | null = null;
let recoverApiPort = 0;

async function startRecoverApi(): Promise<void> {
  const app = express();
  // `verify` captures the raw body so the R4.1 inbound HMAC verifier can check
  // the `timestamp.rawBody` signature (GET requests have an empty body).
  app.use(express.json({ verify: captureRawBody }));
  app.use('/api/integrations/website', websiteTournamentRoutes);
  app.use('/api/integrations', websiteIntegrationRoutes);
  recoverApiServer = http.createServer(app);
  await new Promise<void>((resolve) => recoverApiServer!.listen(0, '127.0.0.1', () => resolve()));
  const address = recoverApiServer.address();
  recoverApiPort = address && typeof address === 'object' ? address.port : 0;
}

/**
 * Posts to the recovery route over node:http (NOT global fetch) so the bot
 * mock's fetch replacement cannot intercept this local request.
 */
function postRecover(cookie?: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: recoverApiPort,
        method: 'POST',
        path: '/api/integrations/recover',
        headers: cookie ? { Cookie: cookie } : {},
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let body: any = null;
          if (text.length > 0) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({ status: res.statusCode || 0, body });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/**
 * Posts a JSON body to the integration routes over node:http (NOT global fetch)
 * so the bot mock cannot intercept this local request.
 */
function postIntegration(
  path: string,
  body: unknown,
  cookie?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: recoverApiPort,
        method: 'POST',
        path,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let parsed: any = null;
          if (text.length > 0) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * R4.1 — signed GET to the bot-authenticated website tournament discovery
 * surface over node:http (so the bot mock's fetch replacement cannot intercept
 * it). `header: null` omits the signature header entirely.
 */
function signedGet(
  path: string,
  opts: { secret?: string; timestamp?: number; header?: string | null } = {}
): Promise<{ status: number; body: any }> {
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = opts.secret ?? TEST_SECRET;
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.`).digest('hex');
  const signature = opts.header === undefined ? `t=${ts},v1=${sig}` : opts.header;
  const headers: Record<string, string> = signature ? { 'X-FalFoos-Signature': signature } : {};
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: recoverApiPort, method: 'GET', path, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => {
          let parsed: any = null;
          if (text.length > 0) {
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = text;
            }
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function seedParticipant(tournamentId: string, playerId: string, ticketRef: string): void {
  getDb()
    .prepare(
      `INSERT INTO tournament_participants (tournament_id, player_id, source, registered_at, ticket_ref, status)
       VALUES (?, ?, 'purchase', ?, ?, 'registered')`
    )
    .run(tournamentId, playerId, Date.now(), ticketRef);
}

function seedIntent(
  requestId: string,
  status: string,
  opts: { playerId?: string; channel?: string; tournamentId?: string; ticketEventId?: string } = {}
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO website_purchase_intents
         (request_id, website_user_id, player_id, youtube_channel_id, tournament_id, game_id,
          status, ticket_event_id, amount, balance_before, balance_after, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 30, 100, 70, ?, ?)`
    )
    .run(
      requestId,
      USER.id,
      opts.playerId ?? PLAYER,
      opts.channel ?? CHANNEL,
      opts.tournamentId ?? TOURNEY,
      GAME,
      status,
      opts.ticketEventId ?? 'evt_seeded',
      now,
      now
    );
}

function intentStatus(requestId: string): string | null {
  const row = getDb()
    .prepare('SELECT status FROM website_purchase_intents WHERE request_id = ?')
    .get(requestId) as { status: string } | undefined;
  return row?.status ?? null;
}

function participant(playerId = PLAYER): any {
  return (
    getDb()
      .prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND player_id = ?')
      .get(TOURNEY, playerId) ?? null
  );
}

function userPlayerRow(userId: string): any {
  return (
    getDb()
      .prepare("SELECT * FROM guests WHERE claimed_user_id = ? AND player_id LIKE 'user:%'")
      .get(userId) ?? null
  );
}

async function main(): Promise<void> {
  initDatabase();
  bot = installBotMock(TEST_SECRET);

  // -------------------------------------------------------------------------
  // Incomplete account behavior
  // -------------------------------------------------------------------------

  await testAsync('incomplete account: no user:<id> Player and guest fallback', async () => {
    reset();
    seedUser(USER.id);
    seedGuest(crypto.randomUUID(), null);
    const guestId = (
      getDb().prepare('SELECT player_id FROM guests WHERE youtube_channel_id IS NULL LIMIT 1').get() as {
        player_id: string;
      }
    ).player_id;
    seedSession('sess-1', USER.id);

    assertNull(ensureUserCanonicalPlayer(USER), 'no claimed Player');
    assertNull(userPlayerRow(USER.id), 'no synthetic user:<id> Player was created');

    const viaGuest = resolveSocketIdentity(`falfoos_session=sess-1; falfoos_guest=${guestId}`);
    assertEqual(viaGuest?.kind, 'guest', 'falls back to guest identity');
    assertEqual(viaGuest?.canonicalPlayerId, guestId, 'guest player id');

    assertNull(resolveSocketIdentity('falfoos_session=sess-1'), 'no identity without guest cookie');
  });

  // -------------------------------------------------------------------------
  // Identity linking
  // -------------------------------------------------------------------------

  await testAsync('link: verifies attestation and claims the EXISTING Player', async () => {
    reset();
    bot.challenges.clear();
    bot.badAttestation = false;
    seedUser(USER.id);
    seedGame();
    seedGuest(PLAYER, CHANNEL);

    const start = await startLink(USER, CHANNEL);
    assertTrue(!!start.challenge_id && !!start.code, 'challenge issued');
    assertEqual(start.youtube_channel_id, CHANNEL, 'channel resolved');

    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.status, 'CLAIMED', 'linked');
    assertEqual(verify.player_id, PLAYER, 'existing player reused');

    const guest = getDb().prepare('SELECT * FROM guests WHERE player_id = ?').get(PLAYER) as any;
    assertEqual(guest.claimed_user_id, USER.id, 'claimed_user_id set on existing Player');
    assertNull(userPlayerRow(USER.id), 'no synthetic Player created');
    assertEqual(findCanonicalPlayerIdByChannel(CHANNEL), PLAYER, 'canonical id unchanged');

    // Idempotent replay.
    const again = await verifyLink(USER, start.request_id);
    assertEqual(again.player_id, PLAYER, 'idempotent re-verify');
  });

  await testAsync('link: invalid attestation signature is rejected', async () => {
    reset();
    bot.challenges.clear();
    bot.badAttestation = true;
    seedUser(USER.id);
    seedGuest(PLAYER, CHANNEL);

    const start = await startLink(USER, CHANNEL);
    let code: string | null = null;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    } finally {
      bot.badAttestation = false;
    }
    assertEqual(code, 'invalid_attestation_signature', 'bad attestation rejected');
  });

  await testAsync('link: account already linked to another Player is refused', async () => {
    reset();
    bot.challenges.clear();
    seedUser(USER.id);
    seedGuest(PLAYER, CHANNEL, USER.id); // account already owns PLAYER
    seedGuest(PLAYER2, CHANNEL2);

    const start = await startLink(USER, CHANNEL2);
    let code: string | null = null;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'account_already_linked', 'no silent replacement');
    const p2 = getDb().prepare('SELECT claimed_user_id FROM guests WHERE player_id = ?').get(PLAYER2) as any;
    assertNull(p2.claimed_user_id, 'second Player not stolen');
  });

  await testAsync('link: claim conflict with another owner is mapped to 409 and fails the intent', async () => {
    reset();
    bot.challenges.clear();
    seedUser(USER.id);
    seedUser(USER2.id);
    // PLAYER is already owned by a DIFFERENT account, so the pre-claim
    // canonical check passes but the atomic claim loses.
    seedGuest(PLAYER, CHANNEL, USER2.id);

    const start = await startLink(USER, CHANNEL);
    let code: string | null = null;
    let httpStatus = 0;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
      httpStatus = err instanceof IntegrationError ? err.httpStatus : 0;
    }
    assertEqual(code, 'player_claimed_by_other', 'player owned by another account is a distinct 409');
    assertEqual(httpStatus, 409, 'conflict is HTTP 409');

    const intent = getDb()
      .prepare('SELECT status, error FROM link_intents WHERE request_id = ?')
      .get(start.request_id) as { status: string; error: string | null } | undefined;
    assertEqual(intent?.status, 'FAILED', 'link intent finalized as FAILED');
    assertEqual(intent?.error, 'player_claimed_by_other', 'intent error recorded');

    const owner = getDb()
      .prepare('SELECT claimed_user_id FROM guests WHERE player_id = ?')
      .get(PLAYER) as { claimed_user_id: string | null };
    assertEqual(owner.claimed_user_id, USER2.id, 'existing owner untouched');
    assertNull(ensureUserCanonicalPlayer(USER), 'claiming account owns no Player');
  });

  test('link: claim-conflict classifier never converts unrelated errors', () => {
    assertTrue(isClaimOwnershipConflict(new Error('claimedByOther')), 'claimedByOther is a conflict');
    assertTrue(
      isClaimOwnershipConflict({
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        message: 'UNIQUE constraint failed: guests.claimed_user_id',
      }),
      'claimed_user_id unique violation is a conflict'
    );
    assertTrue(
      !isClaimOwnershipConflict({
        code: 'SQLITE_CONSTRAINT_UNIQUE',
        message: 'UNIQUE constraint failed: guests.youtube_channel_id',
      }),
      'a different unique column is not a claim conflict'
    );
    assertTrue(!isClaimOwnershipConflict(new Error('unexpected database failure')), 'generic error untouched');
    assertTrue(
      !isClaimOwnershipConflict({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY', message: 'FOREIGN KEY constraint failed' }),
      'foreign-key error not converted'
    );
  });

  await testAsync('link (M1): Bot verify uses a fresh request id; reusing the link/start id conflicts', async () => {
    reset();
    bot.challenges.clear();
    bot.requests.clear();
    bot.badAttestation = false;
    seedUser(USER.id);
    seedGame();
    seedGuest(PLAYER, CHANNEL);

    const start = await startLink(USER, CHANNEL);
    assertTrue(!!start.challenge_id, 'challenge issued');

    // Reproduce the OLD broken behavior directly against the Bot contract:
    // reuse the link/start request id (A) for the verify operation.
    const conflict = await callBot(BOT_ENDPOINTS.linkVerify, {
      request_id: start.request_id,
      challenge_id: start.challenge_id,
      website_user_id: USER.id,
    });
    assertEqual(conflict.status, 409, 'reused request_id rejected by the Bot request store');
    assertEqual((conflict.body as { error?: string }).error, 'request_id_conflict', 'conflict code');

    // The corrected Website flow generates a fresh Bot request id (B) and succeeds.
    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.status, 'CLAIMED', 'link succeeds with a fresh Bot request id');
    assertEqual(verify.player_id, PLAYER, 'existing Player reused');

    // The Bot saw two independent request ids: A (start) and B (verify), A !== B.
    const startIds = [...bot.requests.entries()]
      .filter(([, kind]) => kind === 'identity_link_start')
      .map(([id]) => id);
    const verifyIds = [...bot.requests.entries()]
      .filter(([, kind]) => kind === 'identity_link_verify')
      .map(([id]) => id);
    assertTrue(startIds.includes(start.request_id), 'Bot /link/start used the Website intent id A');
    assertEqual(verifyIds.length, 1, 'exactly one Bot /link/verify request id was used');
    assertTrue(verifyIds[0] !== start.request_id, 'A !== B');

    // The Website link intent remains the correlation identifier.
    const linkIntent = getDb()
      .prepare('SELECT status, challenge_id FROM link_intents WHERE request_id = ?')
      .get(start.request_id) as { status: string; challenge_id: string | null };
    assertEqual(linkIntent.status, 'CLAIMED', 'Website link intent correlated and claimed');
    assertEqual(linkIntent.challenge_id, start.challenge_id, 'challenge correlation intact');

    // Identity rules preserved: no synthetic Player; the EXISTING Player is claimed.
    assertNull(userPlayerRow(USER.id), 'no synthetic user:<id> Player created');
    const guest = getDb()
      .prepare('SELECT claimed_user_id FROM guests WHERE player_id = ?')
      .get(PLAYER) as { claimed_user_id: string | null };
    assertEqual(guest.claimed_user_id, USER.id, 'existing Player claimed by the account');
  });

  // -------------------------------------------------------------------------
  // Phase 8 — explicit LINK_EXISTING_PLAYER vs REGISTER_NEW_PLAYER
  // -------------------------------------------------------------------------

  const ARTIFACT = 'user:' + USER.id;
  const ARTIFACT2 = 'user:' + USER2.id;

  function guestRow(playerId: string): any {
    return getDb().prepare('SELECT * FROM guests WHERE player_id = ?').get(playerId) ?? null;
  }

  function countWhere(table: string, playerId: string): number {
    return (
      getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player_id = ?`).get(playerId) as { n: number }
    ).n;
  }

  function guestsWithChannel(channelId: string): number {
    return (
      getDb().prepare('SELECT COUNT(*) AS n FROM guests WHERE youtube_channel_id = ?').get(channelId) as { n: number }
    ).n;
  }

  /** Seeds B-style history: one tournament participant + LP/Elo ledgers + profile. */
  function seedPlayerBHistory(playerId: string): void {
    const db = getDb();
    const now = Date.now();
    seedParticipant(TOURNEY, playerId, 'evt_history');
    db.prepare(
      `INSERT INTO competitive_profiles
         (player_id, game_id, lp, elo, matches_played, wins, losses, draws, created_at, updated_at)
       VALUES (?, ?, 5, 1199, 2, 1, 1, 0, ?, ?)`
    ).run(playerId, GAME, now, now);
    db.prepare(
      `INSERT INTO lp_transactions
         (player_id, game_id, amount, balance_before, balance_after, reason, source_type, idempotency_key, created_at)
       VALUES (?, ?, 5, 0, 5, 'match_win', 'match', ?, ?)`
    ).run(playerId, GAME, `hist:${playerId}:lp`, now);
    db.prepare(
      `INSERT INTO elo_transactions
         (player_id, game_id, delta, rating_before, rating_after, source_type, idempotency_key, created_at)
       VALUES (?, ?, -1, 1200, 1199, 'match', ?, ?)`
    ).run(playerId, GAME, `hist:${playerId}:elo`, now);
  }

  /** Seeds a user + admin + game + open tournament (FK prerequisites). */
  function seedBase(): void {
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
  }

  await testAsync('phase8: Google login does not create a Player', async () => {
    reset();
    seedUser(USER.id);
    seedSession('sess-p8', USER.id);
    assertNull(ensureUserCanonicalPlayer(USER), 'no canonical Player');
    assertEqual(countWhere('guests', ARTIFACT), 0, 'no synthetic artifact minted');
    assertNull(
      resolveSocketIdentity('falfoos_session=sess-p8'),
      'incomplete account has no identity without a guest cookie'
    );
  });

  await testAsync('phase8: LINK existing channel-backed Player succeeds', async () => {
    reset();
    seedBase();
    seedGuest(PLAYER, CHANNEL, null);
    const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.status, 'CLAIMED', 'linked');
    assertEqual(verify.player_id, PLAYER, 'existing Player reused');
    assertEqual(guestRow(PLAYER).claimed_user_id, USER.id, 'claimed by user');
  });

  await testAsync('phase8: LINK nonexistent channel returns player_not_found', async () => {
    reset();
    seedUser(USER.id);
    const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    let code: string | null = null;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'player_not_found', 'no Player for the channel');
    assertEqual(guestsWithChannel(CHANNEL), 0, 'nothing created');
  });

  await testAsync('phase8: LINK same user existing Player is idempotent', async () => {
    reset();
    seedBase();
    seedGuest(PLAYER, CHANNEL, USER.id);
    const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.status, 'CLAIMED', 'idempotent success');
    assertEqual(verify.player_id, PLAYER, 'same Player');
    const again = await verifyLink(USER, start.request_id);
    assertEqual(again.player_id, PLAYER, 'replay idempotent');
  });

  await testAsync('phase8: LINK Player owned by another user returns player_claimed_by_other', async () => {
    reset();
    seedBase();
    seedUser(USER2.id);
    seedGuest(PLAYER, CHANNEL, USER2.id);
    const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    let code: string | null = null;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'player_claimed_by_other', 'ownership conflict');
    assertEqual(guestRow(PLAYER).claimed_user_id, USER2.id, 'owner untouched');
  });

  await testAsync('phase8: REGISTER new channel creates exactly one Player and claims it', async () => {
    reset();
    seedUser(USER.id);
    const start = await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER');
    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.status, 'CLAIMED', 'registered');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'exactly one Player for the channel');
    const row = guestRow(verify.player_id);
    assertEqual(row.claimed_user_id, USER.id, 'claimed by user');
    assertEqual(row.youtube_channel_id, CHANNEL, 'channel bound');
  });

  await testAsync('phase8: REGISTER existing unclaimed channel reuses the existing Player', async () => {
    reset();
    seedUser(USER.id);
    seedGuest(PLAYER, CHANNEL, null);
    const start = await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER');
    const verify = await verifyLink(USER, start.request_id);
    assertEqual(verify.player_id, PLAYER, 'reused, not duplicated');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'still one Player');
  });

  await testAsync('phase8: REGISTER Player owned by another user returns player_claimed_by_other', async () => {
    reset();
    seedUser(USER.id);
    seedUser(USER2.id);
    seedGuest(PLAYER, CHANNEL, USER2.id);
    const start = await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER');
    let code: string | null = null;
    try {
      await verifyLink(USER, start.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'player_claimed_by_other', 'ownership conflict');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'no duplicate created');
    assertEqual(guestRow(PLAYER).claimed_user_id, USER2.id, 'owner untouched');
  });

  await testAsync('phase8: REGISTER same channel cannot create a duplicate Player', async () => {
    reset();
    seedUser(USER.id);
    const first = await verifyLink(USER, (await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER')).request_id);
    const second = await verifyLink(USER, (await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER')).request_id);
    assertEqual(second.player_id, first.player_id, 'same Player reused');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'exactly one Player');
  });

  await testAsync('phase8: duplicate/replayed REGISTER is idempotent', async () => {
    reset();
    seedUser(USER.id);
    const start = await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER');
    const first = await verifyLink(USER, start.request_id);
    const replay = await verifyLink(USER, start.request_id);
    assertEqual(replay.status, 'CLAIMED', 'replay success');
    assertEqual(replay.player_id, first.player_id, 'same Player');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'no duplicate');
  });

  await testAsync('phase8: two users concurrently LINK the same Player — exactly one owns it', async () => {
    reset();
    seedUser(USER.id);
    seedUser(USER2.id);
    seedGuest(PLAYER, CHANNEL, null);
    const s1 = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    const v1 = await verifyLink(USER, s1.request_id);
    assertEqual(v1.player_id, PLAYER, 'first user wins');
    const s2 = await startLink(USER2, CHANNEL, 'LINK_EXISTING_PLAYER');
    let code: string | null = null;
    try {
      await verifyLink(USER2, s2.request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'player_claimed_by_other', 'second user loses');
    assertEqual(guestRow(PLAYER).claimed_user_id, USER.id, 'exactly one owner');
  });

  await testAsync('phase8: two users concurrently REGISTER the same channel — one Player, one owner', async () => {
    reset();
    seedUser(USER.id);
    seedUser(USER2.id);
    const v1 = await verifyLink(USER, (await startLink(USER, CHANNEL, 'REGISTER_NEW_PLAYER')).request_id);
    let code: string | null = null;
    try {
      await verifyLink(USER2, (await startLink(USER2, CHANNEL, 'REGISTER_NEW_PLAYER')).request_id);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'player_claimed_by_other', 'second user loses');
    assertEqual(guestsWithChannel(CHANNEL), 1, 'exactly one Player');
    assertEqual(guestRow(v1.player_id).claimed_user_id, USER.id, 'exactly one owner');
  });

  await testAsync(
    'phase8: synthetic artifact does not block LINK; claim released, row + history preserved, B history intact',
    async () => {
      reset();
      seedBase();
      seedGuest(ARTIFACT, null, USER.id); // channel-less synthetic artifact
      seedGuest(PLAYER, CHANNEL, null); // canonical bot Player
      seedPlayerBHistory(PLAYER);
      const db = getDb();
      const now = Date.now();
      db.prepare('INSERT INTO matches (id, game_id, started_at) VALUES (?, ?, ?)').run('m-artifact', GAME, now);
      db.prepare(
        'INSERT INTO score_events (match_id, player_id, points, reason, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run('m-artifact', ARTIFACT, 7, 'test', now);

      const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
      const verify = await verifyLink(USER, start.request_id);
      assertEqual(verify.player_id, PLAYER, 'channel Player claimed');

      const a = guestRow(ARTIFACT);
      assertTrue(!!a, 'artifact row still exists');
      assertNull(a.claimed_user_id, 'artifact claim released');
      assertNull(a.youtube_channel_id, 'artifact remains channel-less');
      assertEqual(countWhere('score_events', ARTIFACT), 1, 'artifact history untouched');

      const b = guestRow(PLAYER);
      assertEqual(b.player_id, PLAYER, 'canonical id unchanged');
      assertEqual(b.claimed_user_id, USER.id, 'canonical Player claimed by user');
      assertEqual(b.youtube_channel_id, CHANNEL, 'channel unchanged');
      assertEqual(findCanonicalPlayerIdByChannel(CHANNEL), PLAYER, 'canonical resolution unchanged');
      assertEqual(findLinkedPlayerForUser(USER.id)!.player_id, PLAYER, 'canonical helper resolves B');

      assertEqual(countWhere('tournament_participants', PLAYER), 1, 'B tournament participant intact');
      assertEqual(countWhere('lp_transactions', PLAYER), 1, 'B LP intact');
      assertEqual(countWhere('elo_transactions', PLAYER), 1, 'B Elo intact');
      assertEqual(countWhere('competitive_profiles', PLAYER), 1, 'B competitive profile intact');
    }
  );

  await testAsync('phase8: no unrelated user:* artifact is changed', async () => {
    reset();
    seedUser(USER.id);
    seedUser(USER2.id);
    seedGuest(ARTIFACT, null, USER.id);
    seedGuest(ARTIFACT2, null, USER2.id);
    seedGuest(PLAYER, CHANNEL, null);
    const start = await startLink(USER, CHANNEL, 'LINK_EXISTING_PLAYER');
    await verifyLink(USER, start.request_id);
    assertEqual(guestRow(ARTIFACT2).claimed_user_id, USER2.id, 'other user artifact untouched');
    assertNull(guestRow(ARTIFACT2).youtube_channel_id, 'other artifact still channel-less');
  });

  test('phase8: claimed_user_id uniqueness remains enforced', () => {
    reset();
    seedUser(USER.id);
    seedGuest(PLAYER, CHANNEL, USER.id);
    seedGuest(PLAYER2, CHANNEL2, null);
    let threw = false;
    try {
      getDb().prepare('UPDATE guests SET claimed_user_id = ? WHERE player_id = ?').run(USER.id, PLAYER2);
    } catch {
      threw = true;
    }
    assertTrue(threw, 'second claim for one user is rejected by the DB');
    assertNull(guestRow(PLAYER2).claimed_user_id, 'second Player stays unclaimed');
  });

  test('phase8: youtube_channel_id uniqueness remains enforced', () => {
    reset();
    seedGuest(PLAYER, CHANNEL, null);
    let threw = false;
    try {
      seedGuest(PLAYER2, CHANNEL, null);
    } catch {
      threw = true;
    }
    assertTrue(threw, 'two Players for one channel rejected by the DB');
  });

  // -------------------------------------------------------------------------
  // Bot health client (M3)
  // -------------------------------------------------------------------------

  await testAsync('health (M3): uses GET and accepts the unsigned Bot liveness response', async () => {
    bot.healthMethods = [];
    bot.healthMode = 'ok';
    const res = await health();
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.ok, true, 'ok flag');
    assertEqual(res.body.integration, true, 'integration flag');
    assertEqual(bot.healthMethods.length, 1, 'one health call');
    assertEqual(bot.healthMethods[0], 'GET', 'health uses GET (not POST)');
  });

  await testAsync('health (M3): a non-JSON response is rejected (no false success)', async () => {
    bot.healthMethods = [];
    bot.healthMode = 'nonjson';
    let code: string | null = null;
    try {
      await health();
    } catch (err) {
      code = err instanceof BotIntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'bot_unexpected_response', 'malformed health response rejected');
    assertEqual(bot.healthMethods[0], 'GET', 'still uses GET');
    bot.healthMode = 'ok';
  });

  // -------------------------------------------------------------------------
  // Purchase flow
  // -------------------------------------------------------------------------

  await testAsync('purchase: success debits once and registers the participant', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'PARTICIPANT_REGISTERED', 'registered');
    assertEqual(bot.purchaseCalls, 1, 'one bot debit');

    const row = participant();
    assertTrue(!!row, 'participant row created');
    assertEqual(row.ticket_ref, 'evt_tx-1', 'ticket_ref = bot ticket_event_id');
    assertEqual(row.source, 'purchase', 'source');

    // Double-click / retry returns the recorded success without a second debit.
    const retry = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(retry.status, 'PARTICIPANT_REGISTERED', 'idempotent retry');
    assertEqual(bot.purchaseCalls, 1, 'no second bot debit on retry');
    assertEqual(
      (getDb().prepare('SELECT COUNT(*) n FROM tournament_participants').get() as any).n,
      1,
      'still one participant'
    );
  });

  await testAsync('purchase (R4.1): stored ticket_cost is sent to the bot; browser cannot control it', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseAmount = 30;
    bot.purchaseCalls = 0;
    bot.lastPurchaseBody = null;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    setTicketCost(TOURNEY, 30);
    seedGuest(PLAYER, CHANNEL, USER.id);

    // startPurchase has no price parameter: the browser cannot supply one.
    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'PARTICIPANT_REGISTERED', 'registered');
    assertEqual((bot.lastPurchaseBody as any)?.ticket_cost, 30, 'server-loaded price sent to the bot');
    assertTrue(!!participant(), 'participant registered');
  });

  await testAsync('purchase (R4.1): NULL ticket_cost skips the assertion (legacy bot pricing)', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseAmount = 999; // bot default — never asserted when NULL
    bot.purchaseCalls = 0;
    bot.lastPurchaseBody = null;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'PARTICIPANT_REGISTERED', 'legacy success');
    assertTrue(!('ticket_cost' in (bot.lastPurchaseBody ?? {})), 'no ticket_cost sent when NULL');
  });

  await testAsync('purchase (R4.1): COMPLETED amount mismatch triggers refund, no participant', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseAmount = 30; // bot charged less than the configured price
    bot.purchaseCalls = 0;
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    setTicketCost(TOURNEY, 50);
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'REFUNDED', 'refunded');
    assertNull(participant(), 'no participant registered');
    assertTrue(bot.refundCalls >= 1, 'refund requested through the existing path');
  });

  await testAsync('purchase (R4.1): COMPLETED missing amount with configured cost fails safely', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseAmount = null; // bot omitted the amount field
    bot.purchaseCalls = 0;
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    setTicketCost(TOURNEY, 50);
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'REFUNDED', 'refunded');
    assertNull(participant(), 'no participant');
    assertTrue(bot.refundCalls >= 1, 'refund requested');
  });

  await testAsync('purchase (R4.1): non-terminal response neither asserts nor refunds', async () => {
    reset();
    bot.purchaseMode = 'received';
    bot.purchaseAmount = 30;
    bot.purchaseCalls = 0;
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    setTicketCost(TOURNEY, 50); // would mismatch, but the response is non-terminal
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'BOT_REQUESTED', 'non-terminal');
    assertEqual(bot.refundCalls, 0, 'no refund on non-terminal');
    assertNull(participant(), 'no participant');
    bot.purchaseMode = 'ok';
  });

  await testAsync('purchase (R4.1): idempotent retry does not double-register or refund', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.purchaseAmount = 40;
    bot.purchaseCalls = 0;
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    setTicketCost(TOURNEY, 40);
    seedGuest(PLAYER, CHANNEL, USER.id);

    const first = await startPurchase(USER, TOURNEY, GAME);
    const retry = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(first.status, 'PARTICIPANT_REGISTERED', 'first');
    assertEqual(retry.status, 'PARTICIPANT_REGISTERED', 'retry');
    assertEqual(bot.purchaseCalls, 1, 'exactly one debit');
    assertEqual(bot.refundCalls, 0, 'no refund');
    assertEqual(
      (getDb().prepare('SELECT COUNT(*) n FROM tournament_participants').get() as any).n,
      1,
      'one participant'
    );
  });

  await testAsync('purchase: insufficient balance fails without a participant', async () => {
    reset();
    bot.purchaseMode = 'insufficient';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'FAILED', 'failed');
    assertEqual(result.error, 'insufficient_balance', 'error code');
    assertNull(participant(), 'no participant created');
  });

  await testAsync('purchase: 202 PENDING_RECOVERY is surfaced, never success', async () => {
    reset();
    bot.purchaseMode = 'pending';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'PENDING_RECOVERY', 'pending surfaced');
    assertNull(participant(), 'no participant yet');
    bot.purchaseMode = 'ok';
  });

  await testAsync('purchase (M2): Bot 202 RECEIVED stays non-terminal, never FAILED', async () => {
    reset();
    bot.purchaseMode = 'received';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'BOT_REQUESTED', 'RECEIVED surfaced as non-terminal');
    assertTrue(result.status !== 'FAILED', 'RECEIVED is not a false failure');
    assertEqual(intentStatus(result.request_id), 'BOT_REQUESTED', 'intent remains non-terminal');
    assertNull(participant(), 'no participant yet');
  });

  await testAsync('purchase (M2): Bot 202 PROCESSING stays non-terminal, never FAILED', async () => {
    reset();
    bot.purchaseMode = 'processing';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'BOT_REQUESTED', 'PROCESSING surfaced as non-terminal');
    assertTrue(result.status !== 'FAILED', 'PROCESSING is not a false failure');
    assertEqual(intentStatus(result.request_id), 'BOT_REQUESTED', 'intent remains non-terminal');
    assertNull(participant(), 'no participant yet');
  });

  await testAsync('purchase (M2): double-click/replay while in-flight stays recoverable', async () => {
    reset();
    bot.purchaseMode = 'received';
    bot.purchaseCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const first = await startPurchase(USER, TOURNEY, GAME);
    const second = await startPurchase(USER, TOURNEY, GAME); // replay / double-click
    assertEqual(first.status, 'BOT_REQUESTED', 'first stays non-terminal');
    assertEqual(second.status, 'BOT_REQUESTED', 'replay stays non-terminal');
    assertTrue(second.status !== 'FAILED', 'replay is not a false failure');
    assertEqual(intentStatus(first.request_id), 'BOT_REQUESTED', 'intent still pollable/recoverable');
    assertNull(participant(), 'no participant yet');
    bot.purchaseMode = 'ok';
  });

  await testAsync('purchase: untrusted bot response signature is not treated as success', async () => {
    reset();
    bot.purchaseMode = 'ok';
    bot.badResponseSignature = true;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);

    const result = await startPurchase(USER, TOURNEY, GAME);
    assertEqual(result.status, 'PENDING_RECOVERY', 'unsigned response not trusted');
    assertNull(participant(), 'no participant from untrusted response');
    bot.badResponseSignature = false;
  });

  await testAsync('purchase: unlinked account is refused', async () => {
    reset();
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, null); // not claimed by USER

    let code: string | null = null;
    try {
      await startPurchase(USER, TOURNEY, GAME);
    } catch (err) {
      code = err instanceof IntegrationError ? err.code : 'other';
    }
    assertEqual(code, 'account_not_linked', 'must link first');
  });

  // -------------------------------------------------------------------------
  // Critical refund path
  // -------------------------------------------------------------------------

  await testAsync('refund: already registered (different event) after debit triggers refund', async () => {
    reset();
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);
    seedParticipant(TOURNEY, PLAYER, 'evt_pre_existing'); // different event
    seedIntent('intent-a', 'BOT_DEBIT_CONFIRMED', { ticketEventId: 'evt_new_purchase' });

    const summary = await recoverPurchaseIntents();
    assertTrue(summary.scanned >= 1, 'intent scanned');
    assertEqual(intentStatus('intent-a'), 'REFUNDED', 'refunded, not left charged');
    assertTrue(bot.refundCalls >= 1, 'bot refund requested');
  });

  await testAsync('refund: tournament full after debit triggers refund', async () => {
    reset();
    bot.refundCalls = 0;
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 1, 1); // full
    seedGuest(PLAYER, CHANNEL, USER.id);
    seedIntent('intent-b', 'BOT_DEBIT_CONFIRMED', { ticketEventId: 'evt_full' });

    await recoverPurchaseIntents();
    assertEqual(intentStatus('intent-b'), 'REFUNDED', 'refunded on full');
    assertTrue(bot.refundCalls >= 1, 'bot refund requested');
  });

  await testAsync('recovery: BOT_DEBIT_CONFIRMED intent finalizes participant', async () => {
    reset();
    seedUser(USER.id);
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    seedGuest(PLAYER, CHANNEL, USER.id);
    seedIntent('intent-c', 'BOT_DEBIT_CONFIRMED', { ticketEventId: 'evt_recover' });

    await recoverPurchaseIntents();
    assertEqual(intentStatus('intent-c'), 'PARTICIPANT_REGISTERED', 'finalized');
    const row = getDb()
      .prepare('SELECT * FROM tournament_participants WHERE ticket_ref = ?')
      .get('evt_recover') as any;
    assertTrue(!!row, 'participant registered from recovery');
  });

  await testAsync('regression: bot webhook purchase-event path still works', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament();
    const ch = 'UC' + 'z'.repeat(22);
    // Register via the existing primitive exactly like the webhook does.
    const { registerTicketPurchaseParticipant } = await import('../games/ParticipantService');
    const res = registerTicketPurchaseParticipant(TOURNEY, ch, 'Webhook Player', 'evt_webhook_1');
    assertTrue(res.success, 'webhook registration succeeded');
    const row = getDb()
      .prepare('SELECT * FROM tournament_participants WHERE ticket_ref = ?')
      .get('evt_webhook_1') as any;
    assertTrue(!!row, 'participant created via existing path');
    assertEqual(row.source, 'purchase', 'source');
  });

  // -------------------------------------------------------------------------
  // Step 5F (F3) — manual recovery authorization
  // -------------------------------------------------------------------------

  await startRecoverApi();

  // -------------------------------------------------------------------------
  // R4.1 — bot-authenticated website tournament discovery
  // -------------------------------------------------------------------------

  await testAsync('discovery (R4.1): missing signature header is rejected (400)', async () => {
    reset();
    const res = await signedGet('/api/integrations/website/tournaments', { header: null });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.body.error, 'invalid_signature_header', 'error');
  });

  await testAsync('discovery (R4.1): invalid HMAC is rejected (401)', async () => {
    reset();
    const res = await signedGet('/api/integrations/website/tournaments', { secret: 'wrong-secret' });
    assertEqual(res.status, 401, 'status');
    assertEqual(res.body.error, 'invalid_signature', 'error');
  });

  await testAsync('discovery (R4.1): stale timestamp is rejected (400)', async () => {
    reset();
    const res = await signedGet('/api/integrations/website/tournaments', {
      timestamp: Math.floor(Date.now() / 1000) - 3600,
    });
    assertEqual(res.status, 400, 'status');
    assertEqual(res.body.error, 'stale_timestamp', 'error');
  });

  await testAsync('discovery (R4.1): authenticated request returns open tournaments with price + roster', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 32, 0, 'open');
    setTicketCost(TOURNEY, 100);
    for (let i = 1; i <= 3; i++) {
      seedGuest(`dp-${i}`, null);
      seedParticipant(TOURNEY, `dp-${i}`, `evt_dp-${i}`);
    }
    seedTournament('tourney-draft', 16, 0, 'draft');

    const res = await signedGet('/api/integrations/website/tournaments');
    assertEqual(res.status, 200, 'status');
    const list = res.body.tournaments as any[];
    assertEqual(list.length, 1, 'default status=open only');
    const t = list[0];
    assertEqual(t.tournament_id, TOURNEY, 'tournament id');
    assertEqual(t.ticket_cost, 100, 'ticket_cost');
    assertEqual(t.max_participants, 32, 'max_participants');
    assertEqual(t.participant_count, 3, 'participant_count');
    assertEqual(t.status, 'open', 'status');
    assertEqual(t.game_id, GAME, 'game_id');
    assertTrue(typeof t.name_ar === 'string' && t.name_ar.length > 0, 'name_ar');
    assertTrue(typeof t.game_name_ar === 'string', 'game_name_ar');
    assertTrue(
      !('balance_after' in t) && !('tx_id' in t) && !('product_id' in t),
      'no internal fields leaked'
    );
  });

  await testAsync('discovery (R4.1): status filter works; invalid status rejected', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 32, 0, 'open');
    seedTournament('tourney-active', 16, 0, 'active');

    const active = await signedGet('/api/integrations/website/tournaments?status=active');
    assertEqual(active.status, 200, 'status');
    const list = active.body.tournaments as any[];
    assertEqual(list.length, 1, 'one active');
    assertEqual(list[0].tournament_id, 'tourney-active', 'filtered by status');

    const bogus = await signedGet('/api/integrations/website/tournaments?status=bogus');
    assertEqual(bogus.status, 400, 'invalid status rejected');
    assertEqual(bogus.body.error, 'invalid_status', 'error');
  });

  await testAsync('discovery (R4.1): gameId filter works', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 32, 0, 'open');

    const match = await signedGet(`/api/integrations/website/tournaments?gameId=${GAME}`);
    assertEqual((match.body.tournaments as any[]).length, 1, 'matching game');
    const none = await signedGet('/api/integrations/website/tournaments?gameId=does-not-exist');
    assertEqual((none.body.tournaments as any[]).length, 0, 'unknown game empty');
  });

  await testAsync('discovery (R4.1): detail endpoint returns one tournament; unknown -> 404', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 32, 0, 'open');
    setTicketCost(TOURNEY, 55);

    const res = await signedGet(`/api/integrations/website/tournaments/${TOURNEY}`);
    assertEqual(res.status, 200, 'status');
    assertEqual(res.body.tournament.tournament_id, TOURNEY, 'id');
    assertEqual(res.body.tournament.ticket_cost, 55, 'price');

    const missing = await signedGet('/api/integrations/website/tournaments/does-not-exist');
    assertEqual(missing.status, 404, 'unknown -> 404');
  });

  await testAsync('discovery (R4.1): no Loyalty balance / product / tx data leaks', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedGame();
    seedTournament(TOURNEY, 32, 0, 'open');
    setTicketCost(TOURNEY, 100);

    const res = await signedGet('/api/integrations/website/tournaments');
    const raw = JSON.stringify(res.body);
    assertTrue(!/balance|loyalty|product_id|tx_id|transaction/i.test(raw), 'no sensitive fields');
  });

  await testAsync('recover: unauthenticated request is rejected (401)', async () => {
    reset();
    const res = await postRecover();
    assertEqual(res.status, 401, 'http status');
    assertEqual(res.body.error, 'unauthorized', 'error code');
  });

  await testAsync('recover: authenticated non-admin is forbidden (403)', async () => {
    reset();
    seedUser(USER.id, 'user');
    seedSession('sess-recover-user', USER.id);
    const res = await postRecover('falfoos_session=sess-recover-user');
    assertEqual(res.status, 403, 'http status');
    assertEqual(res.body.error, 'forbidden', 'error code');
  });

  await testAsync('recover: admin receives the unchanged recovery summary', async () => {
    reset();
    seedUser(ADMIN, 'admin');
    seedSession('sess-recover-admin', ADMIN);
    const res = await postRecover('falfoos_session=sess-recover-admin');
    assertEqual(res.status, 200, 'http status');
    assertEqual(typeof res.body.scanned, 'number', 'scanned present');
    assertEqual(typeof res.body.finalized, 'number', 'finalized present');
    assertEqual(typeof res.body.refunded, 'number', 'refunded present');
    assertEqual(typeof res.body.pending, 'number', 'pending present');
  });

  await testAsync('phase8: client-supplied player_id cannot control the claimed Player', async () => {
    reset();
    seedUser(USER.id);
    seedSession('sess-p8-route', USER.id);
    seedGuest(PLAYER, CHANNEL, null);
    seedGuest(PLAYER2, CHANNEL2, null);

    const started = await postIntegration(
      '/api/integrations/link/start',
      { channel: CHANNEL, operation: 'LINK_EXISTING_PLAYER' },
      'falfoos_session=sess-p8-route'
    );
    assertEqual(started.status, 200, 'start ok');
    const requestId = started.body.request_id;
    assertTrue(!!requestId, 'request id issued');

    // A malicious extra player_id must be ignored: identity is derived ONLY
    // from the verified YouTube channel.
    const verified = await postIntegration(
      '/api/integrations/link/verify',
      { request_id: requestId, player_id: PLAYER2 },
      'falfoos_session=sess-p8-route'
    );
    assertEqual(verified.status, 200, 'verify ok');
    assertEqual(verified.body.player_id, PLAYER, 'channel-derived Player, not the injected one');
    assertNull(guestRow(PLAYER2).claimed_user_id, 'injected Player2 untouched');
  });

  if (recoverApiServer) {
    await new Promise<void>((resolve) => recoverApiServer!.close(() => resolve()));
  }

  restoreFetch();
  summarize('WebsiteIntegration');
  cleanupTestDb();
}

main().catch((err) => {
  console.error('WebsiteIntegration test suite crashed:', err);
  process.exit(1);
});
