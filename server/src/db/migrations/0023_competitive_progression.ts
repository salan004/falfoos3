/**
 * Phase 2.z — Global Competitive Progression (additive).
 *
 * Two structures, mirroring the LP/Elo ledger + materialized-profile pattern:
 *
 * 1. `competitive_xp_transactions` — an IMMUTABLE global XP ledger. One row per
 *    eligible competitive event (a completed tournament match result per
 *    player), plus compensating `reversal` / `correction` rows when a result is
 *    corrected. Rows are never edited or deleted; history stays auditable.
 *    `idempotency_key` is UNIQUE and is the authoritative duplicate guard
 *    (e.g. `match:<matchId>:<playerId>:xp`).
 *
 * 2. `competitive_progressions` — the materialized GLOBAL total per player
 *    (`player_id` only, no game_id): this is cross-game competitive XP. It is
 *    always reconstructible from the ledger by summing `amount`, so a rebuild
 *    never depends on LP/Elo/rank or Stream Game points.
 *
 * XP is GLOBAL; LP/Elo/rank remain per (player_id, game_id) in their own tables.
 * Stream Games have no write path here.
 */
export const migration0023CompetitiveProgression = {
  id: '0023_competitive_progression',
  sql: `
CREATE TABLE IF NOT EXISTS competitive_xp_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  match_id        TEXT,
  tournament_id   TEXT,
  game_id         TEXT,
  event_type      TEXT NOT NULL CHECK (event_type IN ('match','correction','reversal','admin','system')),
  amount          INTEGER NOT NULL,
  source_event_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  reversal_of     TEXT,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_competitive_xp_player_time
  ON competitive_xp_transactions(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_competitive_xp_match
  ON competitive_xp_transactions(match_id, player_id);
CREATE INDEX IF NOT EXISTS idx_competitive_xp_game_time
  ON competitive_xp_transactions(game_id, created_at);

CREATE TABLE IF NOT EXISTS competitive_progressions (
  player_id  TEXT PRIMARY KEY NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  total_xp   INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`,
};
