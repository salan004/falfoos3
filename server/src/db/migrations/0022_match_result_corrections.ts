/**
 * Phase 4F — match_result_corrections (additive audit trail).
 *
 * Every admin correction of an already-recorded tournament match result writes
 * exactly one immutable row here. It is the authoritative idempotency guard
 * (`idempotency_key` UNIQUE) and the human-readable audit of what changed and
 * why. Competitive history itself lives in the immutable LP/Elo ledgers; this
 * table records the *correction event*, never derived LP/Elo values.
 *
 * `previous_winner_player_id` / `corrected_winner_player_id` are NULL for a
 * draw. `previous_result` / `corrected_result` are the match-level outcome
 * ('win' when a winner exists, 'draw' otherwise) so the audit is explicit even
 * though a single-elimination bracket normally advances exactly one player.
 *
 * Deletion behavior mirrors tournament history: corrections are deleted only
 * with their match (ON DELETE CASCADE); `tournament_id` / `game_id` are plain
 * TEXT references so this table adds no new RESTRICT edges.
 */
export const migration0022MatchResultCorrections = {
  id: '0022_match_result_corrections',
  sql: `
CREATE TABLE IF NOT EXISTS match_result_corrections (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id                  TEXT NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  tournament_id             TEXT NOT NULL,
  game_id                   TEXT NOT NULL,
  previous_winner_player_id TEXT,
  corrected_winner_player_id TEXT,
  previous_result           TEXT NOT NULL CHECK (previous_result IN ('win','draw')),
  corrected_result          TEXT NOT NULL CHECK (corrected_result IN ('win','draw')),
  reason                    TEXT NOT NULL,
  actor_id                  TEXT,
  idempotency_key           TEXT NOT NULL UNIQUE,
  created_at                INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_result_corrections_match
  ON match_result_corrections(match_id);
CREATE INDEX IF NOT EXISTS idx_match_result_corrections_tournament
  ON match_result_corrections(tournament_id);
`,
};
