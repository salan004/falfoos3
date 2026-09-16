import { getDb } from '../db/db';
import crypto from 'crypto';

/**
 * Phase 3 — Bot Webhook Events idempotency.
 *
 * Records processed bot events to prevent duplicate processing.
 * The event_id from the bot (evt_<tx_id>) is the canonical deduplication key.
 */

export interface BotWebhookEventRow {
  event_id: string;
  event_type: string;
  payload_json: string;
  processed_at: number;
  status: 'success' | 'error';
  error_message?: string;
}

/**
 * Atomically check if event was processed and record it if not.
 * Returns { processed: true, status, error_message } if already processed
 * Returns { processed: false } if this is the first time and it was recorded
 */
export function tryRecordEvent(
  eventId: string,
  eventType: string,
  payload: object,
  status: 'success' | 'error' = 'success',
  errorMessage?: string
): { processed: boolean; existingStatus?: string; existingError?: string } {
  const db = getDb();
  const now = Date.now();

  const result = db.transaction(() => {
    // Try to insert the event - if it already exists, this will fail due to PK constraint
    const insertResult = db.prepare(`
      INSERT OR IGNORE INTO bot_webhook_events (event_id, event_type, payload_json, processed_at, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(eventId, eventType, JSON.stringify(payload), now, status, errorMessage ?? null);

    if (insertResult.changes > 0) {
      // We successfully inserted - this is the first processing
      return { processed: false };
    }

    // Event already exists - get its current status
    const existing = db.prepare('SELECT status, error_message FROM bot_webhook_events WHERE event_id = ?').get(eventId) as
      | { status: string; error_message: string | null }
      | undefined;

    return {
      processed: true,
      existingStatus: existing?.status,
      existingError: existing?.error_message ?? undefined,
    };
  })();

  return result;
}

export function recordBotWebhookEvent(eventId: string, eventType: string, payload: object): void {
  const db = getDb();
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO bot_webhook_events (event_id, event_type, payload_json, processed_at, status)
    VALUES (?, ?, ?, ?, 'success')
  `).run(eventId, eventType, JSON.stringify(payload), now);
}

export function isEventProcessed(eventId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT event_id FROM bot_webhook_events WHERE event_id = ?').get(eventId);
  return !!row;
}

export function getBotWebhookEvent(eventId: string): BotWebhookEventRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM bot_webhook_events WHERE event_id = ?').get(eventId) as BotWebhookEventRow | undefined;
  return row ?? null;
}