/**
 * Phase 11B — initial schema (better-sqlite3).
 * Timestamps are unix-ms INTEGERs, consistent with the rest of the codebase.
 * Runtime game state stays in memory; this schema persists accounts/sessions,
 * guest identities, match history, participation and score events only.
 */
export const migration0001Init = {
  id: '0001_init',
  sql: `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url   TEXT,
  role         TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at   INTEGER NOT NULL,
  disabled_at  INTEGER
);

CREATE TABLE IF NOT EXISTS auth_identities (
  provider     TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_uid)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS guests (
  player_id       TEXT PRIMARY KEY NOT NULL,
  display_name    TEXT NOT NULL,
  avatar_url      TEXT,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  claimed_user_id TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id          TEXT PRIMARY KEY NOT NULL,
  game_id     TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS participations (
  match_id  TEXT NOT NULL REFERENCES matches(id),
  player_id TEXT NOT NULL REFERENCES guests(player_id),
  status    TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS score_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   TEXT NOT NULL REFERENCES matches(id),
  player_id  TEXT NOT NULL REFERENCES guests(player_id),
  points     INTEGER NOT NULL,
  reason     TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS yt_connections (
  owner_user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id),
  video_id      TEXT,
  connected_at  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_guests_claimed ON guests(claimed_user_id);
CREATE INDEX IF NOT EXISTS idx_participations_player ON participations(player_id);
CREATE INDEX IF NOT EXISTS idx_score_events_player ON score_events(player_id, created_at);
CREATE INDEX IF NOT EXISTS idx_score_events_match ON score_events(match_id);
`,
};
