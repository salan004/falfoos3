import { Router, type Request, type Response } from 'express';
import { verifyBotWebhook } from '../middleware/verifyBotWebhook';
import {
  getBotWebhookEvent,
  recordBotWebhookEventSuccess,
  recordBotWebhookEventError,
} from '../games/BotWebhookService';
import { findPlayerByYouTubeChannelId, registerTicketPurchaseParticipant } from '../games/ParticipantService';
import { fetchYouTubeChannelAvatarUrl } from '../games/YouTubeChannelAvatar';
import { getTournamentById } from '../games/TournamentService';

/**
 * Phase 3 — Bot purchase event webhook endpoint.
 *
 * Receives tournament ticket purchase events from the deployed FalFoos bot,
 * verifies the HMAC signature, resolves the tournament player by YouTube
 * channel id, validates the tournament, and registers the participant
 * transactionally.
 *
 * The external contract is owned by the DEPLOYED bot and MUST be accepted
 * exactly as sent:
 *
 * {
 *   "event_id": "evt_<transaction_id>",
 *   "event_type": "ticket_purchase",
 *   "payload": {
 *     "tournament_id": "<tournament_uuid>",
 *     "game_id": "<game_uuid>",
 *     "youtube_channel_id": "<youtube_channel_id>",
 *     "youtube_name": "<youtube_name>",
 *     "transaction_id": "<transaction_id>"
 *   }
 * }
 *
 * Headers:
 * - X-FalFoos-Signature: t=<timestamp>,v1=<hex_signature>
 * - Idempotency-Key: <event_id>
 *
 * The older `purchase.completed` / `purchase.product_metadata` envelope is NOT
 * accepted.
 */

export const botRoutes = Router();

/** The only accepted event type; also stored in bot_webhook_events.event_type. */
const SUPPORTED_EVENT_TYPE = 'ticket_purchase';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readIdempotencyKey(req: Request): string | undefined {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readRequiredString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return value.trim();
}

botRoutes.post('/purchase-event', verifyBotWebhook, async (req: Request, res: Response) => {
  try {
    const body = req.body as unknown;

    if (!isRecord(body)) {
      res.status(400).json({ error: 'invalid_payload', message: 'Invalid event payload' });
      return;
    }

    const eventId = readRequiredString(body, 'event_id');
    if (!eventId) {
      res.status(400).json({ error: 'invalid_event_id', message: 'Missing or invalid event_id' });
      return;
    }

    if (body.event_type !== SUPPORTED_EVENT_TYPE) {
      res.status(400).json({
        error: 'unsupported_event_type',
        message: `Unsupported event_type: ${String(body.event_type)}`,
      });
      return;
    }

    const payload = body.payload;
    if (!isRecord(payload)) {
      res.status(400).json({ error: 'missing_payload', message: 'Missing or invalid payload' });
      return;
    }

    const tournamentId = readRequiredString(payload, 'tournament_id');
    if (!tournamentId) {
      res.status(400).json({ error: 'missing_tournament_id', message: 'payload.tournament_id is required' });
      return;
    }

    const gameId = readRequiredString(payload, 'game_id');
    if (!gameId) {
      res.status(400).json({ error: 'missing_game_id', message: 'payload.game_id is required' });
      return;
    }

    const youtubeChannelId = readRequiredString(payload, 'youtube_channel_id');
    if (!youtubeChannelId) {
      res.status(400).json({ error: 'missing_youtube_channel_id', message: 'payload.youtube_channel_id is required' });
      return;
    }

    const youtubeName = typeof payload.youtube_name === 'string' ? payload.youtube_name : null;
    const transactionId = typeof payload.transaction_id === 'string' ? payload.transaction_id : null;

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

    // Canonical audit payload, mirroring the deployed bot contract exactly.
    const auditPayload = {
      event_id: eventId,
      event_type: SUPPORTED_EVENT_TYPE,
      payload: {
        tournament_id: tournamentId,
        game_id: gameId,
        youtube_channel_id: youtubeChannelId,
        youtube_name: youtubeName,
        transaction_id: transactionId,
      },
    };

    const fail = (statusCode: number, error: string, message: string): void => {
      // Never mark failures as success — keep the event retryable.
      recordBotWebhookEventError(dedupeKey, SUPPORTED_EVENT_TYPE, auditPayload, error);
      res.status(statusCode).json({ error, message });
    };

    // Tournament validation: exists → game matches → open for registration.
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

    // Resolve the YouTube channel to a canonical player_id. A channel that has
    // never been seen before now gets an unclaimed Guest created for it, so a
    // valid ticket purchase is no longer rejected as `unknown_youtube_player`.
    const displayName = youtubeName && youtubeName.trim().length > 0 ? youtubeName.trim() : youtubeChannelId;

    // Optional, best-effort avatar enrichment for NEW guests only. The network
    // call happens OUTSIDE the registration transaction; any failure yields
    // null and never affects purchase processing or registration.
    let avatarUrl: string | null = null;
    if (!findPlayerByYouTubeChannelId(youtubeChannelId)) {
      avatarUrl = await fetchYouTubeChannelAvatarUrl(youtubeChannelId);
    }

    const registration = registerTicketPurchaseParticipant(
      tournamentId,
      youtubeChannelId,
      displayName,
      eventId,
      avatarUrl
    );

    if (!registration.success) {
      const errorMsg = registration.error || 'registration_failed';

      if (errorMsg.includes('already registered')) {
        fail(409, 'already_registered', errorMsg);
        return;
      }

      const statusCode = errorMsg.includes('full') ? 409 : 400;
      fail(statusCode, errorMsg.includes('full') ? 'tournament_full' : 'registration_failed', errorMsg);
      return;
    }

    // Record success only AFTER the participant transaction committed.
    recordBotWebhookEventSuccess(dedupeKey, SUPPORTED_EVENT_TYPE, auditPayload);

    const participant = registration.participant;
    console.log(
      `[BotWebhook] Registered player ${participant?.player_id} for tournament ${tournamentId} via event ${eventId}`
    );

    res.json({
      success: true,
      ...(registration.idempotent ? { idempotent: true } : {}),
      participant: participant
        ? {
            player_id: participant.player_id,
            tournament_id: participant.tournament_id,
            registered_at: participant.registered_at,
          }
        : undefined,
    });
  } catch (err) {
    console.error('[BotWebhook] Unexpected error:', err);
    res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
  }
});
