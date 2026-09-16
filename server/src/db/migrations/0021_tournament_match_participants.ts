/**
 * Phase 4C — tournament_match_participants (additive).
 *
 * The two participants of a match. Correctness is enforced structurally:
 * - PRIMARY KEY (match_id, player_id)  → a player cannot appear twice in one match
 * - UNIQUE (match_id, slot)            → a slot holds at most one player
 * - CHECK (slot IN (1,2))              → exactly two stable slots
 *
 * `seed` records the original bracket seed (1 = highest) for round-1 players;
 * it is NULL for players who advanced in later rounds. Slots are stable: the
 * visual layer can rely on them, and advancement always targets the recorded
 * `next_match_slot`.
 */
export const migration0021TournamentMatchParticipants = {
  id: '0021_tournament_match_participants',
  sql: `
CREATE TABLE IF NOT EXISTS tournament_match_participants (
  match_id   TEXT NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  player_id  TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  slot       INTEGER NOT NULL CHECK (slot IN (1,2)),
  seed       INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  UNIQUE (match_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_tournament_match_participants_player
  ON tournament_match_participants(player_id);
`,
};
