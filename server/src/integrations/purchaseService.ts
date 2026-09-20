import crypto from 'crypto';
import { getDb } from '../db/db';
import { findLinkedPlayerForUser } from '../identity/identityService';
import type { SessionUser } from '../auth/session';
import {
  getParticipant,
  getParticipantCount,
  registerTicketPurchaseParticipant,
  type ParticipantRow,
} from '../games/ParticipantService';
import { getTournamentById } from '../games/TournamentService';
import { IntegrationError } from './errors';
import { callBot, BOT_ENDPOINTS, BotIntegrationError } from './falfoosBotClient';

/**
 * Phase 7 — website-originated tournament ticket purchase.
 *
 * The bot owns the Streamlabs debit (and its price). The website only:
 *   1. validates defensively (never as the sole protection),
 *   2. sends a signed, idempotent purchase request keyed by `request_id`,
 *   3. records the signed result durably,
 *   4. registers the participant with the EXISTING atomic primitive
 *      (`registerTicketPurchaseParticipant`, ticket_ref = bot ticket_event_id),
 *   5. requests an automatic refund through the bot when registration fails
 *      after a confirmed debit — closing the "charged with no ticket" gap.
 *
 * No Streamlabs logic, no loyalty counter, no price handling lives here.
 */

export type PurchaseStatus =
  | 'INTENT_CREATED'
  | 'BOT_REQUESTED'
  | 'BOT_DEBIT_CONFIRMED'
  | 'PARTICIPANT_REGISTERED'
  | 'FAILED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED'
  | 'PENDING_RECOVERY';

const TERMINAL: PurchaseStatus[] = ['PARTICIPANT_REGISTERED', 'FAILED', 'REFUNDED'];

interface LinkedIdentity {
  player_id: string;
  youtube_channel_id: string;
  display_name: string | null;
}

export interface PurchaseIntentRow {
  request_id: string;
  website_user_id: string;
  player_id: string;
  youtube_channel_id: string;
  tournament_id: string;
  game_id: string;
  status: PurchaseStatus;
  bot_tx_id: string | null;
  ticket_event_id: string | null;
  product_id: number | null;
  amount: number | null;
  balance_before: number | null;
  balance_after: number | null;
  bot_result_json: string | null;
  refund_request_id: string | null;
  refund_result_json: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export interface PurchaseResult {
  request_id: string;
  status: PurchaseStatus;
  player_id: string;
  tx_id?: string | null;
  ticket_event_id?: string | null;
  amount?: number | null;
  balance_before?: number | null;
  balance_after?: number | null;
  participant?: ParticipantRow | null;
  refund_request_id?: string | null;
  error?: string | null;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function getIntent(requestId: string): PurchaseIntentRow | null {
  const row = getDb()
    .prepare('SELECT * FROM website_purchase_intents WHERE request_id = ?')
    .get(requestId) as PurchaseIntentRow | undefined;
  return row ?? null;
}

/**
 * Phase 7 / Step 5C — read-only correlation lookup for the bot purchase-event
 * webhook (F5 refund guard). The bot's `event_id` equals the intent's
 * `ticket_event_id` (`evt_<tx_id>`), and `idx_purchase_intents_event` backs the
 * match. Never mutates state.
 */
export function getPurchaseIntentByTicketEventId(ticketEventId: string): PurchaseIntentRow | null {
  const id = typeof ticketEventId === 'string' ? ticketEventId.trim() : '';
  if (!id) return null;
  const row = getDb()
    .prepare(
      `SELECT * FROM website_purchase_intents
        WHERE ticket_event_id = ?
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .get(id) as PurchaseIntentRow | undefined;
  return row ?? null;
}

function getCompletedIntent(userId: string, tournamentId: string, gameId: string): PurchaseIntentRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM website_purchase_intents
        WHERE website_user_id = ? AND tournament_id = ? AND game_id = ?
          AND status = 'PARTICIPANT_REGISTERED'
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, tournamentId, gameId) as PurchaseIntentRow | undefined;
  return row ?? null;
}

function getActiveIntent(userId: string, tournamentId: string, gameId: string): PurchaseIntentRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM website_purchase_intents
        WHERE website_user_id = ? AND tournament_id = ? AND game_id = ?
          AND status NOT IN ('PARTICIPANT_REGISTERED','FAILED','REFUNDED')
        ORDER BY created_at DESC LIMIT 1`
    )
    .get(userId, tournamentId, gameId) as PurchaseIntentRow | undefined;
  return row ?? null;
}

function insertIntent(
  requestId: string,
  userId: string,
  linked: LinkedIdentity,
  tournamentId: string,
  gameId: string
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO website_purchase_intents
         (request_id, website_user_id, player_id, youtube_channel_id,
          tournament_id, game_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'INTENT_CREATED', ?, ?)`
    )
    .run(requestId, userId, linked.player_id, linked.youtube_channel_id, tournamentId, gameId, now, now);
}

function updateIntent(requestId: string, fields: Record<string, unknown>): void {
  const allowed = [
    'status',
    'bot_tx_id',
    'ticket_event_id',
    'product_id',
    'amount',
    'balance_before',
    'balance_after',
    'bot_result_json',
    'refund_request_id',
    'refund_result_json',
    'error',
  ];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(requestId);
  getDb().prepare(`UPDATE website_purchase_intents SET ${sets.join(', ')} WHERE request_id = ?`).run(...params);
}

function resolveLinkedIdentity(userId: string): LinkedIdentity | null {
  // Phase 8 — single source of truth: a canonical Player is channel-backed.
  return findLinkedPlayerForUser(userId);
}

function displayNameFor(playerId: string, channelId: string): string {
  const row = getDb().prepare('SELECT display_name FROM guests WHERE player_id = ?').get(playerId) as
    | { display_name: string | null }
    | undefined;
  return row?.display_name || channelId;
}

function publicResult(intent: PurchaseIntentRow, participant?: ParticipantRow | null): PurchaseResult {
  return {
    request_id: intent.request_id,
    status: intent.status,
    player_id: intent.player_id,
    tx_id: intent.bot_tx_id,
    ticket_event_id: intent.ticket_event_id,
    amount: intent.amount,
    balance_before: intent.balance_before,
    balance_after: intent.balance_after,
    refund_request_id: intent.refund_request_id,
    error: intent.error,
    ...(participant !== undefined ? { participant } : {}),
  };
}

// ---------------------------------------------------------------------------
// Purchase flow
// ---------------------------------------------------------------------------

export async function startPurchase(
  user: SessionUser,
  tournamentId: string,
  gameId: string
): Promise<PurchaseResult> {
  const tid = typeof tournamentId === 'string' ? tournamentId.trim() : '';
  const gid = typeof gameId === 'string' ? gameId.trim() : '';
  if (!tid || !gid) throw new IntegrationError('invalid_request', 400, 'tournament_id and game_id are required');

  const linked = resolveLinkedIdentity(user.id);
  if (!linked) {
    throw new IntegrationError('account_not_linked', 409, 'Link your account to a FalFoos Player first');
  }

  // Double-click / refresh / retry of an already-completed purchase: return the
  // recorded success instead of attempting (or charging) again.
  const completed = getCompletedIntent(user.id, tid, gid);
  if (completed) return publicResult(completed);

  // Defensive checks only. They never replace the bot's debit authorization or
  // the participant PK/atomic capacity enforcement, and they are race-prone.
  const tournament = getTournamentById(tid);
  if (!tournament) throw new IntegrationError('tournament_not_found', 404, 'Tournament not found');
  if (tournament.game_id !== gid) throw new IntegrationError('game_mismatch', 409, 'Tournament belongs to another game');
  if (tournament.status !== 'open') throw new IntegrationError('tournament_not_open', 409, 'Tournament is not open');
  if (
    tournament.max_participants !== null &&
    getParticipantCount(tid) >= tournament.max_participants
  ) {
    throw new IntegrationError('tournament_full', 409, 'Tournament is full');
  }
  if (getParticipant(tid, linked.player_id)) {
    throw new IntegrationError('already_registered', 409, 'Already registered in this tournament');
  }

  let intent = getActiveIntent(user.id, tid, gid);
  if (!intent) {
    const requestId = crypto.randomUUID();
    try {
      insertIntent(requestId, user.id, linked, tid, gid);
    } catch (err) {
      // Lost a concurrent race for the active-intent unique index: reuse it.
      if (String(err instanceof Error ? err.message : err).includes('UNIQUE')) {
        intent = getActiveIntent(user.id, tid, gid);
      } else {
        throw err;
      }
    }
    if (!intent) intent = getIntent(requestId);
  }
  if (!intent) throw new IntegrationError('intent_creation_failed', 500, 'Could not create purchase intent');

  return resumeIntent(intent);
}

/** Drives an intent from its current durable state to a terminal state. */
async function resumeIntent(intent: PurchaseIntentRow): Promise<PurchaseResult> {
  if (intent.status === 'PARTICIPANT_REGISTERED' || intent.status === 'FAILED' || intent.status === 'REFUNDED') {
    return publicResult(intent);
  }
  if (intent.status === 'BOT_DEBIT_CONFIRMED') {
    return registerParticipant(intent);
  }
  if (intent.status === 'REFUND_REQUESTED') {
    return requestRefund(intent);
  }
  return runPurchase(intent);
}

async function runPurchase(intent: PurchaseIntentRow): Promise<PurchaseResult> {
  updateIntent(intent.request_id, { status: 'BOT_REQUESTED' });

  let bot;
  try {
    bot = await callBot<Record<string, unknown>>(BOT_ENDPOINTS.purchase, {
      request_id: intent.request_id,
      website_user_id: intent.website_user_id,
      youtube_channel_id: intent.youtube_channel_id,
      tournament_id: intent.tournament_id,
      game_id: intent.game_id,
    });
  } catch (err) {
    if (err instanceof BotIntegrationError && err.code === 'integration_not_configured') {
      updateIntent(intent.request_id, { status: 'FAILED', error: err.code });
      throw new IntegrationError(err.code, 503, err.message);
    }
    // Transport failure / untrusted signature: the debit may or may not have
    // happened. Keep it recoverable; the SAME request_id is safe to retry.
    const message = err instanceof Error ? err.message : String(err);
    updateIntent(intent.request_id, { status: 'PENDING_RECOVERY', error: message });
    return publicResult(getIntent(intent.request_id)!);
  }

  const body = bot.body as {
    status?: string;
    tx_id?: string;
    ticket_event_id?: string;
    product_id?: number;
    amount?: number;
    balance_before?: number;
    balance_after?: number;
    error?: string;
  };
  const status = typeof body.status === 'string' ? body.status : '';

  if (status === 'COMPLETED' && body.tx_id && body.ticket_event_id) {
    updateIntent(intent.request_id, {
      status: 'BOT_DEBIT_CONFIRMED',
      bot_tx_id: body.tx_id,
      ticket_event_id: body.ticket_event_id,
      product_id: body.product_id ?? null,
      amount: body.amount ?? null,
      balance_before: body.balance_before ?? null,
      balance_after: body.balance_after ?? null,
      bot_result_json: JSON.stringify(bot.body),
      error: null,
    });
    return registerParticipant(getIntent(intent.request_id)!);
  }

  if (status === 'PENDING_RECOVERY') {
    updateIntent(intent.request_id, {
      status: 'PENDING_RECOVERY',
      bot_result_json: JSON.stringify(bot.body),
      error: body.error ?? 'pending_recovery',
    });
    return publicResult(getIntent(intent.request_id)!);
  }

  // Phase 7 (M2) — terminal failure ONLY for the statuses the Bot explicitly
  // reports as failed/refunded. Every other status is a legitimate NON-TERMINAL
  // in-flight state (e.g. RECEIVED / PROCESSING / DEBITED / REFUND_PENDING, or an
  // unrecognized future state). A valid non-terminal Bot response must never be
  // converted into a terminal FAILED merely because it is not COMPLETED: keep the
  // existing BOT_REQUESTED state so the intent stays pollable and recoverable.
  if (status === 'FAILED' || status === 'REFUND_REQUESTED' || status === 'REFUNDED') {
    const error = body.error || status.toLowerCase();
    updateIntent(intent.request_id, {
      status: 'FAILED',
      error,
      bot_result_json: JSON.stringify(bot.body),
    });
    return publicResult(getIntent(intent.request_id)!);
  }

  updateIntent(intent.request_id, {
    status: 'BOT_REQUESTED',
    bot_result_json: JSON.stringify(bot.body),
    error: body.error ?? null,
  });
  return publicResult(getIntent(intent.request_id)!);
}

// ---------------------------------------------------------------------------
// Participant registration (reuses the existing atomic primitive)
// ---------------------------------------------------------------------------

async function registerParticipant(intent: PurchaseIntentRow): Promise<PurchaseResult> {
  const eventId = intent.ticket_event_id;
  if (!eventId) {
    updateIntent(intent.request_id, { status: 'PENDING_RECOVERY', error: 'missing_ticket_event_id' });
    return publicResult(getIntent(intent.request_id)!);
  }

  const displayName = displayNameFor(intent.player_id, intent.youtube_channel_id);
  const result = registerTicketPurchaseParticipant(
    intent.tournament_id,
    intent.youtube_channel_id,
    displayName,
    eventId
  );

  if (result.success) {
    updateIntent(intent.request_id, {
      status: 'PARTICIPANT_REGISTERED',
      error: null,
    });
    return publicResult(getIntent(intent.request_id)!, result.participant ?? null);
  }

  // Confirmed debit but registration genuinely failed (full / duplicate from a
  // different event). Do NOT leave the user charged without a ticket: refund.
  const reason = result.error || 'registration_failed';
  updateIntent(intent.request_id, { status: 'REFUND_REQUESTED', error: reason });
  return requestRefund(getIntent(intent.request_id)!, reason);
}

// ---------------------------------------------------------------------------
// Refund (via the bot; the website never touches Streamlabs)
// ---------------------------------------------------------------------------

async function requestRefund(intent: PurchaseIntentRow, reason?: string): Promise<PurchaseResult> {
  const refundRequestId = intent.refund_request_id || crypto.randomUUID();
  updateIntent(intent.request_id, {
    status: 'REFUND_REQUESTED',
    refund_request_id: refundRequestId,
  });

  try {
    const bot = await callBot<Record<string, unknown>>(BOT_ENDPOINTS.refund, {
      request_id: refundRequestId,
      website_user_id: intent.website_user_id,
      related_request_id: intent.request_id,
      reason: reason || intent.error || 'registration_failed',
    });
    const body = bot.body as { status?: string; tx_id?: string; error?: string };
    updateIntent(intent.request_id, {
      refund_result_json: JSON.stringify(bot.body),
    });
    if (body.status === 'COMPLETED') {
      updateIntent(intent.request_id, { status: 'REFUNDED', error: intent.error });
      return publicResult(getIntent(intent.request_id)!);
    }
    // Any other status (FAILED / PENDING_RECOVERY / unexpected) stays
    // REFUND_REQUESTED so recovery retries with the SAME refund request_id.
    return publicResult(getIntent(intent.request_id)!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateIntent(intent.request_id, { error: message });
    return publicResult(getIntent(intent.request_id)!);
  }
}

// ---------------------------------------------------------------------------
// Status + recovery
// ---------------------------------------------------------------------------

export function getPurchaseStatus(user: SessionUser, requestId: string): PurchaseResult {
  const id = typeof requestId === 'string' ? requestId.trim() : '';
  if (!id) throw new IntegrationError('invalid_request_id', 400, 'request_id is required');
  const intent = getIntent(id);
  if (!intent) throw new IntegrationError('purchase_request_not_found', 404, 'Unknown purchase request');
  if (intent.website_user_id !== user.id) {
    throw new IntegrationError('purchase_request_forbidden', 403, 'Purchase request belongs to another account');
  }
  return publicResult(intent);
}

export interface RecoverySummary {
  scanned: number;
  finalized: number;
  refunded: number;
  pending: number;
}

/**
 * Startup/recovery sweep: drives any non-terminal intent to a terminal state.
 * Safe to call repeatedly (all steps are keyed on the durable request_id).
 */
export async function recoverPurchaseIntents(limit = 200): Promise<RecoverySummary> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM website_purchase_intents
        WHERE status IN ('INTENT_CREATED','BOT_REQUESTED','BOT_DEBIT_CONFIRMED','PENDING_RECOVERY','REFUND_REQUESTED')
        ORDER BY created_at ASC LIMIT ?`
    )
    .all(limit) as PurchaseIntentRow[];

  const summary: RecoverySummary = { scanned: rows.length, finalized: 0, refunded: 0, pending: 0 };
  for (const row of rows) {
    try {
      const result = await resumeIntent(row);
      if (result.status === 'PARTICIPANT_REGISTERED') summary.finalized += 1;
      else if (result.status === 'REFUNDED') summary.refunded += 1;
      else summary.pending += 1;
    } catch {
      summary.pending += 1;
    }
  }
  return summary;
}

export { resolveLinkedIdentity };
