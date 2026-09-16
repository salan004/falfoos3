/**
 * Phase 4B — elo_transactions (additive, immutable ledger).
 *
 * Independent from LP. One immutable row per competitive Elo change:
 * `delta = rating_after - rating_before`. History is never mutated; a
 * correction/rebuild is expressed through the ledger architecture
 * (`source_type IN ('correction','reversal')`) rather than rewriting rows.
 *
 * `idempotency_key` is UNIQUE and authoritative (e.g.
 * `match:<matchId>:<playerId>:elo`). Initialization of a profile with the
 * default 1200 Elo does NOT create a ledger row — only real changes do.
 *
 * `k_factor` / `opponent_rating_avg` / `expected_score` are nullable so an
 * explicit admin adjustment (which has no opponent or K) can be recorded
 * without inventing values. `match_id` is plain TEXT: tournament matches do not
 * exist in this phase.
 */
export const migration0019EloTransactions = {
  id: '0019_elo_transactions',
  sql: `
CREATE TABLE IF NOT EXISTS elo_transactions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id           TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  game_id             TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  delta               INTEGER NOT NULL,
  rating_before       INTEGER NOT NULL,
  rating_after        INTEGER NOT NULL,
  opponent_rating_avg REAL,
  expected_score      REAL,
  k_factor            INTEGER,
  source_type         TEXT NOT NULL CHECK (source_type IN ('match','tournament','admin','correction','reversal','system')),
  source_id           TEXT,
  match_id            TEXT,
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_elo_transactions_player_game_time
  ON elo_transactions(player_id, game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_elo_transactions_game_time
  ON elo_transactions(game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_elo_transactions_source
  ON elo_transactions(source_type, source_id);
`,
};
