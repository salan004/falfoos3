import { getDb } from '../db/db';

/**
 * Phase 3 — Bot Webhook Events idempotency.
 *
 * Records processed bot events to prevent duplicate processing.
 * The event_id from the bot (evt_<tx_id>) is the canonical deduplication key.
 *
 * Safety contract (Phase 3D fix):
 *   - An event is only ever recorded as `success` AFTER participant registration
 *     has actually succeeded.
 *   - Failures are recorded as `error` (retryable) so a later delivery can retry.
 *   - Recording uses an UPSERT so a previously-failed event can later be marked
 *     successful once it finally succeeds.
 */

export interface BotWebhookEventRow {
  event_id: string;
  event_type: string;
  payload_json: string;
  processed_at: number;
  status: 'success' | 'error';
  error_message?: string | null;
}

/** Reads a single recorded bot event, or null when it has never been seen. */
export function getBotWebhookEvent(eventId: string): BotWebhookEventRow | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM bot_webhook_events WHERE event_id = ?')
    .get(eventId) as BotWebhookEventRow | undefined;
  return row ?? null;
}

/** True when the event has been delivered and the registration succeeded. */
export function isEventProcessedSuccessfully(eventId: string): boolean {
  const row = getBotWebhookEvent(eventId);
  return row?.status === 'success';
}

function upsertEvent(
  eventId: string,
  eventType: string,
  payload: object,
  status: 'success' | 'error',
  errorMessage: string | null
): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO bot_webhook_events (event_id, event_type, payload_json, processed_at, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET
      event_type    = excluded.event_type,
      payload_json  = excluded.payload_json,
      processed_at  = excluded.processed_at,
      status        = excluded.status,
      error_message = excluded.error_message
  `).run(eventId, eventType, JSON.stringify(payload), now, status, errorMessage);
}

/**
 * Marks an event as successfully processed. Must only be called after the
 * participant registration for this event has committed.
 */
export function recordBotWebhookEventSuccess(eventId: string, eventType: string, payload: object): void {
  upsertEvent(eventId, eventType, payload, 'success', null);
}

/**
 * Marks an event as failed. The row stays retryable: a subsequent delivery of
 * the same event_id is allowed to attempt processing again.
 */
export function recordBotWebhookEventError(
  eventId: string,
  eventType: string,
  payload: object,
  errorMessage: string
): void {
  upsertEvent(eventId, eventType, payload, 'error', errorMessage);
}

/** Backwards-compatible helper: true once an event row exists (any status). */
export function isEventProcessed(eventId: string): boolean {
  return getBotWebhookEvent(eventId) !== null;
}

/** @deprecated Retained for compatibility; prefer the explicit success/error writers. */
export function recordBotWebhookEvent(eventId: string, eventType: string, payload: object): void {
  recordBotWebhookEventSuccess(eventId, eventType, payload);
}
