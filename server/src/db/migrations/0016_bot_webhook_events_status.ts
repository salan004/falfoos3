/**
 * Phase 3C — Add status and error_message columns to bot_webhook_events.
 *
 * Allows tracking event processing status (success/error) and error details
 * for proper idempotency and retry handling.
 */
export const migration0016BotWebhookEventsStatus = {
  id: '0016_bot_webhook_events_status',
  sql: `
-- Add status column (success/error) and error_message for retry semantics
ALTER TABLE bot_webhook_events ADD COLUMN status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success','error'));
ALTER TABLE bot_webhook_events ADD COLUMN error_message TEXT;
`,
};