/**
 * Phase 12A — match winner persistence (original roadmap: Persistent Player
 * Experience).
 *
 * match_winners records BOTH scopes:
 * - scope='match'  → full-activation victory (Profile "Wins" statistic)
 * - scope='round'  → single-round victory (per-game statistics only)
 *
 * Rows are written additively by GameManager when a game broadcasts the
 * standardized `game:finished` event. The PK makes duplicate announcements
 * idempotent; SQLite stays write-through and never blocks gameplay.
 *
 * The matches(game_id, started_at) index also serves future leaderboard
 * queries filtered per game (Phase 13 groundwork, harmless today).
 */
export const migration0003MatchResults = {
  id: '0003_match_results',
  sql: `
CREATE TABLE IF NOT EXISTS match_winners (
  match_id   TEXT NOT NULL REFERENCES matches(id),
  player_id  TEXT NOT NULL REFERENCES guests(player_id),
  scope      TEXT NOT NULL CHECK (scope IN ('match', 'round')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_matches_game_time
  ON matches(game_id, started_at);

CREATE INDEX IF NOT EXISTS idx_match_winners_player
  ON match_winners(player_id, scope);
`,
};
