/**
 * Phase 4C — tournament_matches (additive).
 *
 * Explicit single-elimination bracket graph. Each row is one match position in
 * one round. `next_match_id` / `next_match_slot` record where the winner
 * advances, so the bracket is never inferred from player ordering and is
 * compatible with a future left/right/centered visual renderer.
 *
 * Round numbering is 1-based: round 1 is the earliest playable round and
 * `round_no = totalRounds` is the final. Slot numbering is 1-based within a
 * round. A match has two participant slots (1 and 2).
 *
 * Deletion behavior (intentionally non-destructive for history):
 * - tournament_id → tournaments ON DELETE CASCADE (bracket belongs to a tournament;
 *   tournaments can only be deleted while draft, so brackets are effectively protected)
 * - game_id → games ON DELETE RESTRICT (matches the tournaments convention)
 * - winner_player_id → guests ON DELETE SET NULL (match history survives player removal)
 * - next_match_id → tournament_matches ON DELETE SET NULL (self-reference)
 *
 * `result_idempotency_key` is the authoritative guard against duplicate result
 * application (`match:<matchId>:result`). SQLite permits multiple NULLs in a
 * UNIQUE column, so unplayed matches carry NULL safely.
 *
 * The final match has `next_match_id = NULL`. Its winner is the tournament
 * champion; no separate champion column is introduced in this phase.
 */
export const migration0020TournamentMatches = {
  id: '0020_tournament_matches',
  sql: `
CREATE TABLE IF NOT EXISTS tournament_matches (
  id                     TEXT PRIMARY KEY NOT NULL,
  tournament_id          TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_id                TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  round_no               INTEGER NOT NULL CHECK (round_no >= 1),
  slot_no                INTEGER NOT NULL CHECK (slot_no >= 1),
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','scheduled','active','completed','cancelled','disputed')),
  best_of                INTEGER,
  winner_player_id       TEXT REFERENCES guests(player_id) ON DELETE SET NULL,
  next_match_id          TEXT REFERENCES tournament_matches(id) ON DELETE SET NULL,
  next_match_slot        INTEGER CHECK (next_match_slot IN (1,2)),
  scheduled_at           INTEGER,
  started_at             INTEGER,
  completed_at           INTEGER,
  result_source          TEXT CHECK (result_source IN ('admin','auto','import')),
  result_idempotency_key TEXT UNIQUE,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  UNIQUE (tournament_id, round_no, slot_no)
);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament
  ON tournament_matches(tournament_id, round_no, slot_no);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_status
  ON tournament_matches(tournament_id, status);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_next
  ON tournament_matches(next_match_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_winner
  ON tournament_matches(winner_player_id);
`,
};
