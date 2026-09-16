import { Router, type Request, type Response } from 'express';
import { verifyBotWebhook } from '../middleware/verifyBotWebhook';
import { tryRecordEvent } from '../games/BotWebhookService';
import { findPlayerByYouTubeChannelId } from '../games/ParticipantService';
import { getTournamentById } from '../games/TournamentService';
import { registerParticipantTransactional } from '../games/ParticipantService';
import { getDb } from '../db/db';

/**
 * Phase 3 — Bot purchase event webhook endpoint.
 *
 * Receives tournament ticket purchase events from the FalFoos bot.
 * Verifies HMAC, validates payload, resolves YouTube identity, registers participant.
 */

export const botRoutes = Router();

interface BotPurchaseEventPayload {
  tournament_id: string;
  game_id: string;
  youtube_channel_id: string;
  youtube_name?: string;
  youtube_avatar_url?: string;
  transaction_id?: string;
  [key: string]: any;
}

interface BotEvent {
  event_id: string;
  event_type: string;
  payload: BotPurchaseEventPayload;
}

/**
 * POST /api/v1/bot/purchase-event
 *
 * Expected headers:
 * - X-FalFoos-Signature: t=<timestamp>,v1=<hex_signature>
 * - Idempotency-Key: <event_id> (same as event_id in payload)
 *
 * Expected body:
 * {
 *   "event_id": "evt_<tx_id>",
 *   "event_type": "ticket_purchase",
 *   "payload": {
 *     "tournament_id": "...",
 *     "game_id": "...",
 *     "youtube_channel_id": "UC...",
 *     "youtube_name": "Channel Name",
 *     "youtube_avatar_url": "https://...",
 *     "transaction_id": "..."
 *   }
 * }
 */
botRoutes.post('/purchase-event', verifyBotWebhook, async (req: Request, res: Response) => {
  try {
    const event = req.body as BotEvent;

    // Validate event structure
    if (!event || typeof event !== 'object') {
      res.status(400).json({ error: 'invalid_payload', message: 'Invalid event payload' });
      return;
    }

    const { event_id, event_type, payload } = event;

    if (!event_id || typeof event_id !== 'string') {
      res.status(400).json({ error: 'invalid_event_id', message: 'Missing or invalid event_id' });
      return;
    }

    if (!event_type || typeof event_type !== 'string') {
      res.status(400).json({ error: 'invalid_event_type', message: 'Missing or invalid event_type' });
      return;
    }

    if (event_type !== 'ticket_purchase') {
      res.status(400).json({ error: 'unsupported_event_type', message: `Unsupported event type: ${event_type}` });
      return;
    }

    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'invalid_payload', message: 'Missing or invalid payload' });
      return;
    }

    const { tournament_id, game_id, youtube_channel_id } = payload;

    if (!tournament_id || typeof tournament_id !== 'string') {
      res.status(400).json({ error: 'missing_tournament_id', message: 'tournament_id is required' });
      return;
    }

    if (!game_id || typeof game_id !== 'string') {
      res.status(400).json({ error: 'missing_game_id', message: 'game_id is required' });
      return;
    }

    if (!youtube_channel_id || typeof youtube_channel_id !== 'string') {
      res.status(400).json({ error: 'missing_youtube_channel_id', message: 'youtube_channel_id is required' });
      return;
    }

    // Atomically check and record idempotency
    const idempotency = tryRecordEvent(event_id, event_type, event);

    if (idempotency.processed) {
      // Event already processed - return success (idempotent)
      const existingStatus = idempotency.existingStatus;
      const existingError = idempotency.existingError;

      if (existingStatus === 'success') {
        res.json({ success: true, idempotent: true, message: 'Event already processed successfully' });
        return;
      }

      // Previously failed - allow retry for certain error types
      // Only retry for temporary conditions, not permanent failures
      const permanentErrors = ['tournament_not_found', 'game_mismatch', 'unknown_youtube_player', 'invalid_payload', 'invalid_event_id', 'unsupported_event_type'];
      const isPermanent = permanentErrors.some(e => existingError?.includes(e));

      if (isPermanent) {
        res.status(400).json({ error: 'event_permanently_failed', message: existingError || 'Event previously failed with permanent error' });
        return;
      }

      // Temporary error - allow retry, don't return idempotent success
      // Fall through to process again
    }

    // Verify tournament exists and matches game
    const tournament = getTournamentById(tournament_id);
    if (!tournament) {
      // Record as permanent failure
      tryRecordEvent(event_id, 'ticket_purchase', event, 'error', 'tournament_not_found');
      res.status(404).json({ error: 'tournament_not_found', message: 'Tournament not found' });
      return;
    }

    if (tournament.game_id !== game_id) {
      tryRecordEvent(event_id, 'ticket_purchase', event, 'error', 'game_mismatch');
      res.status(409).json({ error: 'game_mismatch', message: 'Tournament does not belong to specified game' });
      return;
    }

    if (tournament.status !== 'open') {
      // Tournament not open - this could be temporary (e.g., not started yet)
      // Record as error but don't mark as permanently processed
      tryRecordEvent(event_id, 'ticket_purchase', event, 'error', 'tournament_not_open');
      res.status(409).json({ error: 'tournament_not_open', message: 'Tournament is not open for registration' });
      return;
    }

    // Resolve YouTube Channel ID to canonical player_id
    const player = findPlayerByYouTubeChannelId(youtube_channel_id);
    if (!player) {
      // Unknown YouTube player - this is a permanent failure (requires manual linking)
      tryRecordEvent(event_id, 'ticket_purchase', event, 'error', 'unknown_youtube_player');
      console.warn(`[BotWebhook] Unknown YouTube channel ID: ${youtube_channel_id} for event ${event_id}`);
      res.status(404).json({ error: 'unknown_youtube_player', message: 'YouTube channel not linked to any player' });
      return;
    }

    // Register participant transactionally
    const result = registerParticipantTransactional(
      tournament_id,
      player.player_id,
      'purchase',
      event_id
    );

    if (!result.success) {
      const errorMsg = result.error || 'registration_failed';
      // Check if it's a capacity issue (temporary-ish) or duplicate (permanent)
      const isCapacity = errorMsg.includes('full');
      const isDuplicate = errorMsg.includes('already registered');

      tryRecordEvent(event_id, 'ticket_purchase', event, 'error', errorMsg);

      let statusCode = 400;
      if (isCapacity) statusCode = 409;
      else if (isDuplicate) statusCode = 409;

      res.status(statusCode).json({ error: 'registration_failed', message: errorMsg });
      return;
    }

    // Record event as successfully processed
    tryRecordEvent(event_id, 'ticket_purchase', event, 'success');

    console.log(`[BotWebhook] Successfully registered player ${result.participant?.player_id} for tournament ${tournament_id} via event ${event_id}`);

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