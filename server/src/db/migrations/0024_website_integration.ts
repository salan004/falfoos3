/**
 * Phase 7 — Website <-> Bot integration durable state (additive).
 *
 * Two UI-facing concerns get their own durable tables so a browser refresh,
 * a double-click, a network retry or a mid-flight crash can never silently
 * double-charge or lose an in-flight operation:
 *
 * 1. `link_intents` — one row per account -> Player linking attempt, tracking
 *    the bot-issued challenge through to the atomic `claimed_user_id` claim.
 *
 * 2. `website_purchase_intents` — one row per website tournament purchase,
 *    tracking the bot debit through to participant registration (or refund).
 *
 * Nothing here touches `guests`, `tournament_participants`, competitive data,
 * or any existing table. These are integration bookkeeping tables only.
 */
export const migration0024WebsiteIntegration = {
  id: '0024_website_integration',
  sql: `
CREATE TABLE IF NOT EXISTS link_intents (
  request_id          TEXT PRIMARY KEY NOT NULL,
  website_user_id     TEXT NOT NULL,
  challenge_id        TEXT,
  youtube_channel_id  TEXT,
  youtube_name        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('CREATED','CHALLENGE_ISSUED','VERIFIED','CLAIMED','FAILED')),
  attestation_json    TEXT,
  error               TEXT,
  expires_at          INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_link_intents_user ON link_intents(website_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_link_intents_status ON link_intents(status);

CREATE TABLE IF NOT EXISTS website_purchase_intents (
  request_id          TEXT PRIMARY KEY NOT NULL,
  website_user_id     TEXT NOT NULL,
  player_id           TEXT NOT NULL,
  youtube_channel_id  TEXT NOT NULL,
  tournament_id       TEXT NOT NULL,
  game_id             TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN (
                        'INTENT_CREATED','BOT_REQUESTED','BOT_DEBIT_CONFIRMED',
                        'PARTICIPANT_REGISTERED','FAILED','REFUND_REQUESTED',
                        'REFUNDED','PENDING_RECOVERY')),
  bot_tx_id           TEXT,
  ticket_event_id     TEXT,
  product_id          INTEGER,
  amount              INTEGER,
  balance_before      INTEGER,
  balance_after       INTEGER,
  bot_result_json     TEXT,
  refund_request_id   TEXT,
  refund_result_json  TEXT,
  error               TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_intents_user ON website_purchase_intents(website_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_status ON website_purchase_intents(status);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_tournament ON website_purchase_intents(tournament_id, game_id);
CREATE INDEX IF NOT EXISTS idx_purchase_intents_event ON website_purchase_intents(ticket_event_id);

-- At most ONE in-flight purchase per (user, tournament, game). Terminal states
-- free the slot so a user can buy for a later tournament / retry after failure.
CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_intents_active
  ON website_purchase_intents(website_user_id, tournament_id, game_id)
  WHERE status NOT IN ('PARTICIPANT_REGISTERED','FAILED','REFUNDED');
`,
};
