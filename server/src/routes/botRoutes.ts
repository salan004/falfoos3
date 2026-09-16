import { Router, type Request, type Response } from 'express';
import { verifyBotWebhook } from '../middleware/verifyBotWebhook';
import {
  getBotWebhookEvent,
  recordBotWebhookEventSuccess,
  recordBotWebhookEventError,
} from '../games/BotWebhookService';
import {
  findPlayerByYouTubeChannelId,
  getParticipant,
  registerParticipantTransactional,
} from '../games/ParticipantService';
import { getTournamentById } from '../games/TournamentService';

/**
 * Phase 3 — Bot purchase event webhook endpoint.
 *
 * Receives tournament ticket purchase events from the FalFoos bot
 * (`event: "purchase.completed"`), verifies the HMAC signature, resolves the
 * tournament player by YouTube channel id, validates the tournament, and
 * registers the participant transactionally.
 *
 * The external contract is owned by the bot and MUST NOT change:
 *
 * {
 *   "event": "purchase.completed",
 *   "event_id": "evt_<tx_id>",
 *   "timestamp": "<ISO timestamp>",
 *   "purchase": {
 *     "tx_id": "...",
 *     "discord_user_id": "...",
 *     "youtube_channel_id": "UC...",
 *     "youtube_name": "...",
 *     "product_id": 123,
 *     "product_name": "...",
 *     "product_type": "tournament_ticket",
 *     "product_metadata": { "tournamentId": "...", "gameId": "...", "ticketType": "standard" },
 *     "price": 500,
 *     "balance_after": 1250
 *   }
 * }
 *
 * Headers:
 * - X-FalFoos-Signature: t=<timestamp>,v1=<hex_signature>
 * - Idempotency-Key: <event_id>
 */

export const botRoutes = Router();

const SUPPORTED_EVENT = 'purchase.completed';
const SUPPORTED_PRODUCT_TYPE = 'tournament_ticket';
/** Stored in bot_webhook_events.event_type for audit clarity. */
const WEBHOOK_EVENT_TYPE = 'tournament_ticket_purchase';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

botRoutes.post('/purchase-event', verifyBotWebhook, async (req: Request, res: Response) => {
  try {
    const body = req.body as unknown;

    if (!isRecord(body)) {
      res.status(400).json({ error: 'invalid_payload', message: 'Invalid event payload' });
      return;
    }

    if (body.event !== SUPPORTED_EVENT) {
      res.status(400).json({
        error: 'unsupported_event',
        message: `Unsupported event: ${String(body.event)}`,
      });
      return;
    }

    const rawEventId = body.event_id;
    if (typeof rawEventId !== 'string' || rawEventId.trim().length === 0) {
      res.status(400).json({ error: 'invalid_event_id', message: 'Missing or invalid event_id' });
      return;
    }
    const eventId = rawEventId.trim();

    const purchase = body.purchase;
    if (!isRecord(purchase)) {
      res.status(400).json({ error: 'invalid_purchase', message: 'Missing or invalid purchase' });
      return;
    }

    const rawYoutubeChannelId = purchase.youtube_channel_id;
    if (typeof rawYoutubeChannelId !== 'string' || rawYoutubeChannelId.trim().length === 0) {
      res.status(400).json({ error: 'missing_youtube_channel_id', message: 'youtube_channel_id is required' });
      return;
    }
    const youtubeChannelId = rawYoutubeChannelId.trim();

    const metadata = purchase.product_metadata;
    if (!isRecord(metadata)) {
      res.status(400).json({ error: 'missing_product_metadata', message: 'product_metadata is required' });
      return;
    }

    const rawTournamentId = metadata.tournamentId;
    if (typeof rawTournamentId !== 'string' || rawTournamentId.trim().length === 0) {
      res.status(400).json({ error: 'missing_tournament_id', message: 'product_metadata.tournamentId is required' });
      return;
    }
    const tournamentId = rawTournamentId.trim();

    const rawGameId = metadata.gameId;
    if (typeof rawGameId !== 'string' || rawGameId.trim().length === 0) {
      res.status(400).json({ error: 'missing_game_id', message: 'product_metadata.gameId is required' });
      return;
    }
    const gameId = rawGameId.trim();

    const productType = typeof purchase.product_type === 'string' ? purchase.product_type : '';
    if (productType !== SUPPORTED_PRODUCT_TYPE) {
      res.status(400).json({
        error: 'unsupported_product_type',
        message: `Expected product_type "${SUPPORTED_PRODUCT_TYPE}", received "${productType}"`,
      });
      return;
    }

    // Duplicate protection: the bot sends Idempotency-Key = event_id. Prefer the
    // header when present, but always fall back to the validated body event_id.
    const idempotencyKey = readIdempotencyKey(req);
    const dedupeKey = idempotencyKey ?? eventId;

    // Idempotent replay of an already-successful delivery.
    const existing = getBotWebhookEvent(dedupeKey);
    if (existing && existing.status === 'success') {
      res.json({ success: true, idempotent: true, message: 'Event already processed successfully' });
      return;
    }

    // Canonical audit payload (discord_user_id retained as audit metadata only).
    const auditPayload = {
      event: SUPPORTED_EVENT,
      event_id: eventId,
      timestamp: body.timestamp ?? null,
      purchase: {
        tx_id: purchase.tx_id ?? null,
        discord_user_id: purchase.discord_user_id ?? null,
        youtube_channel_id: youtubeChannelId,
        youtube_name: purchase.youtube_name ?? null,
        product_id: purchase.product_id ?? null,
        product_name: purchase.product_name ?? null,
        product_type: productType,
        product_metadata: {
          tournamentId,
          gameId,
          ticketType: metadata.ticketType ?? null,
        },
        price: purchase.price ?? null,
        balance_after: purchase.balance_after ?? null,
      },
    };

    const fail = (statusCode: number, error: string, message: string): void => {
      // Never mark failures as success — keep the event retryable.
      recordBotWebhookEventError(dedupeKey, WEBHOOK_EVENT_TYPE, auditPayload, error);
      res.status(statusCode).json({ error, message });
    };

    const tournament = getTournamentById(tournamentId);
    if (!tournament) {
      fail(404, 'tournament_not_found', 'Tournament not found');
      return;
    }

    if (tournament.game_id !== gameId) {
      fail(409, 'game_mismatch', 'Tournament does not belong to specified game');
      return;
    }

    if (tournament.status !== 'open') {
      fail(409, 'tournament_not_open', 'Tournament is not open for registration');
      return;
    }

    const player = findPlayerByYouTubeChannelId(youtubeChannelId);
    if (!player) {
      console.warn(`[BotWebhook] Unknown YouTube channel ID: ${youtubeChannelId} for event ${eventId}`);
      fail(404, 'unknown_youtube_player', 'YouTube channel not linked to any player');
      return;
    }

    const result = registerParticipantTransactional(
      tournamentId,
      player.player_id,
      'purchase',
      eventId
    );

    if (!result.success) {
      const errorMsg = result.error || 'registration_failed';

      if (errorMsg.includes('already registered')) {
        // The same event may have committed the registration before a crash
        // prevented the success record. If this exact event produced the
        // existing row, treat the redelivery as an idempotent success.
        const existingParticipant = getParticipant(tournamentId, player.player_id);
        if (existingParticipant && existingParticipant.ticket_ref === eventId) {
          recordBotWebhookEventSuccess(dedupeKey, WEBHOOK_EVENT_TYPE, auditPayload);
          res.json({
            success: true,
            idempotent: true,
            participant: {
              player_id: existingParticipant.player_id,
              tournament_id: existingParticipant.tournament_id,
              registered_at: existingParticipant.registered_at,
            },
          });
          return;
        }
        fail(409, 'already_registered', errorMsg);
        return;
      }

      const statusCode = errorMsg.includes('full') ? 409 : 400;
      fail(statusCode, errorMsg.includes('full') ? 'tournament_full' : 'registration_failed', errorMsg);
      return;
    }

    // Record success only AFTER the participant transaction committed.
    recordBotWebhookEventSuccess(dedupeKey, WEBHOOK_EVENT_TYPE, auditPayload);

    console.log(
      `[BotWebhook] Registered player ${result.participant?.player_id} for tournament ${tournamentId} via event ${eventId}`
    );

    res.json({
      success: true,
      participant: {
        player_id: result.participant?.player_id,
        tournament_id: result.participant?.tournament_id,
        registered_at: result.participant?.registered_at,
      },
    });
  } catch (err) {
    console.error('[BotWebhook] Unexpected error:', err);
    res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
});
