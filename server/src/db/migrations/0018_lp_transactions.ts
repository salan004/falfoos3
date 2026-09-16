/**
 * Phase 4B — lp_transactions (additive, immutable ledger).
 *
 * Every persisted LP change has one immutable transaction row. History is
 * never edited or deleted: corrections are represented by NEW compensating
 * transactions (`source_type IN ('correction','reversal')`), preserving an
 * auditable chain.
 *
 * `amount` is the EFFECTIVE change (`balance_after - balance_before`) so the
 * ledger arithmetic is always internally consistent, including when a loss is
 * floored at zero. The nominal result (-20 for a loss) is recoverable from
 * `reason` (`match_win` / `match_loss` / `match_draw`) and the LP engine rules.
 *
 * `idempotency_key` is UNIQUE and is the authoritative duplicate guard (e.g.
 * `match:<matchId>:<playerId>:lp`). `tournament_id` / `match_id` are plain
 * TEXT references by design: this phase must not depend on `tournament_matches`,
 * which does not exist yet.
 *
 * FK deletion behavior mirrors competitive_profiles / existing tournaments.
 */
export const migration0018LpTransactions = {
  id: '0018_lp_transactions',
  sql: `
CREATE TABLE IF NOT EXISTS lp_transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id       TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  game_id         TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  amount          INTEGER NOT NULL,
  balance_before  INTEGER NOT NULL CHECK (balance_before >= 0),
  balance_after   INTEGER NOT NULL CHECK (balance_after >= 0),
  reason          TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('match','tournament','admin','correction','reversal','system')),
  source_id       TEXT,
  tournament_id   TEXT,
  match_id        TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lp_transactions_player_game_time
  ON lp_transactions(player_id, game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_game_time
  ON lp_transactions(game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_lp_transactions_source
  ON lp_transactions(source_type, source_id);
`,
};
