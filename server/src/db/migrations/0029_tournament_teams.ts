/**
 * Roadmap #2 — Team vs Team & 2v2 tournament support (additive + one safe rebuild).
 *
 * Additive metadata on `tournaments`:
 * - `competition_type`  individual | team_vs_team | two_vs_two (default individual)
 * - `team_formation`    random | player_choice | NULL (NULL for individual)
 * - `team1_name` / `team2_name`   admin-custom names for Team vs Team
 * - `teams_locked_at`   set once team composition is frozen (bracket generation)
 *
 * New team tables:
 * - `tournament_teams`         one row per team (team_no, name_ar, capacity)
 * - `tournament_team_members`  membership, unique per player per tournament
 *
 * Match generalization:
 * - `tournament_matches.winner_team_id` added (legacy `winner_player_id` preserved).
 * - `tournament_match_participants` rebuilt so a match side (slot) may hold
 *   EITHER a player_id (legacy 1v1) OR a team_id (team tournaments), never both
 *   and never neither. `UNIQUE(match_id, slot)` is preserved and rows are copied
 *   verbatim with `team_id = NULL`.
 *
 * SQLite safety (inspected before writing):
 * - existing indexes on tournament_match_participants: idx_tournament_match_participants_player
 * - triggers: none; views: none; PRAGMA foreign_key_check: empty
 * - no table references tournament_match_participants, so drop/rename is safe
 *   without disabling foreign_keys (which is a no-op inside a transaction).
 * - The standard create-new -> copy-data -> drop-old -> rename sequence is used.
 *   `PRAGMA foreign_key_check` is executed after the rebuild.
 */
export const migration0029TournamentTeams = {
  id: '0029_tournament_teams',
  sql: `
-- ---------------------------------------------------------------------------
-- 1. Tournament metadata (additive, safe defaults; existing rows stay individual)
-- ---------------------------------------------------------------------------
ALTER TABLE tournaments ADD COLUMN competition_type TEXT NOT NULL DEFAULT 'individual'
  CHECK (competition_type IN ('individual','team_vs_team','two_vs_two'));
ALTER TABLE tournaments ADD COLUMN team_formation TEXT
  CHECK (team_formation IS NULL OR team_formation IN ('random','player_choice'));
ALTER TABLE tournaments ADD COLUMN team1_name TEXT;
ALTER TABLE tournaments ADD COLUMN team2_name TEXT;
ALTER TABLE tournaments ADD COLUMN teams_locked_at INTEGER;

-- ---------------------------------------------------------------------------
-- 2. Teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_teams (
  id            TEXT PRIMARY KEY NOT NULL,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_no       INTEGER NOT NULL CHECK (team_no >= 1),
  name_ar       TEXT NOT NULL,
  capacity      INTEGER CHECK (capacity IS NULL OR capacity >= 1),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (tournament_id, team_no)
);

CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament
  ON tournament_teams(tournament_id);

-- ---------------------------------------------------------------------------
-- 3. Team membership (a player belongs to at most one team per tournament)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tournament_team_members (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL REFERENCES tournament_teams(id) ON DELETE CASCADE,
  player_id     TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  joined_at     INTEGER NOT NULL,
  assigned_by   TEXT NOT NULL DEFAULT 'random'
                  CHECK (assigned_by IN ('random','player','admin')),
  PRIMARY KEY (tournament_id, player_id),
  UNIQUE (team_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_team_members_team
  ON tournament_team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tournament_team_members_player
  ON tournament_team_members(player_id);

-- ---------------------------------------------------------------------------
-- 4. Match winner generalization (legacy winner_player_id preserved)
-- ---------------------------------------------------------------------------
ALTER TABLE tournament_matches ADD COLUMN winner_team_id TEXT
  REFERENCES tournament_teams(id) ON DELETE SET NULL;

-- Correction audit gains explicit team-winner columns so team corrections are
-- unambiguous (the legacy player columns stay for individual corrections).
ALTER TABLE match_result_corrections ADD COLUMN previous_winner_team_id TEXT;
ALTER TABLE match_result_corrections ADD COLUMN corrected_winner_team_id TEXT;

-- ---------------------------------------------------------------------------
-- 5. Safe rebuild of tournament_match_participants
--    A slot holds exactly one competitor: player OR team.
-- ---------------------------------------------------------------------------
CREATE TABLE tournament_match_participants_new (
  match_id   TEXT NOT NULL REFERENCES tournament_matches(id) ON DELETE CASCADE,
  player_id  TEXT REFERENCES guests(player_id) ON DELETE CASCADE,
  team_id    TEXT REFERENCES tournament_teams(id) ON DELETE CASCADE,
  slot       INTEGER NOT NULL CHECK (slot IN (1,2)),
  seed       INTEGER,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id),
  UNIQUE (match_id, slot),
  CHECK ((player_id IS NOT NULL) <> (team_id IS NOT NULL))
);

INSERT INTO tournament_match_participants_new (match_id, player_id, team_id, slot, seed, created_at)
  SELECT match_id, player_id, NULL, slot, seed, created_at
  FROM tournament_match_participants;

DROP TABLE tournament_match_participants;

ALTER TABLE tournament_match_participants_new RENAME TO tournament_match_participants;

CREATE INDEX IF NOT EXISTS idx_tournament_match_participants_player
  ON tournament_match_participants(player_id);
CREATE INDEX IF NOT EXISTS idx_tournament_match_participants_team
  ON tournament_match_participants(team_id);

-- ---------------------------------------------------------------------------
-- 6. Post-rebuild integrity validation
-- ---------------------------------------------------------------------------
PRAGMA foreign_key_check;
`,
};
