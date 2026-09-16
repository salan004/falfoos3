/**
 * Phase 3 — Bot Webhook Events idempotency table (additive).
 *
 * Records processed bot events to prevent duplicate processing.
 * The event_id from the bot (evt_<tx_id>) is the canonical deduplication key.
 */
export const migration0014BotWebhookEvents = {
  id: '0014_bot_webhook_events',
  sql: `
CREATE TABLE IF NOT EXISTS bot_webhook_events (
  event_id      TEXT PRIMARY KEY NOT NULL,
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  processed_at  INTEGER NOT NULL
);
`,
};