/**
 * Phase 4B — competitive_profiles (additive).
 *
 * Materialized competitive state for one `player_id + game_id` pair. The
 * composite primary key is the foundation of per-game isolation: a player's
 * Dueling Grounds progress and Rocket League progress are separate rows and
 * can never affect each other.
 *
 * Rank is intentionally NOT stored here. Rank is always derived from LP via
 * `computeRank(lp)` in `server/src/competitive/ranks.ts`, guaranteeing
 * `LP -> Rank` with no possibility of a conflicting cached rank.
 *
 * Deletion behavior mirrors the existing conventions:
 * - player_id → guests ON DELETE CASCADE (same as tournament_participants)
 * - game_id   → games  ON DELETE RESTRICT (same as tournaments)
 */
export const migration0017CompetitiveProfiles = {
  id: '0017_competitive_profiles',
  sql: `
CREATE TABLE IF NOT EXISTS competitive_profiles (
  player_id       TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  game_id         TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  lp              INTEGER NOT NULL DEFAULT 0 CHECK (lp >= 0),
  elo             INTEGER NOT NULL DEFAULT 1200,
  matches_played  INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
  wins            INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses          INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
  draws           INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
  last_played_at  INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (player_id, game_id),
  CHECK (wins + losses + draws <= matches_played)
);

CREATE INDEX IF NOT EXISTS idx_competitive_profiles_game_lp
  ON competitive_profiles(game_id, lp DESC);
CREATE INDEX IF NOT EXISTS idx_competitive_profiles_game_elo
  ON competitive_profiles(game_id, elo DESC);
`,
};
