/**
 * Phase 3 — Tournaments table (additive).
 *
 * Database-backed tournament metadata.
 * Does NOT modify existing gameplay systems.
 */
export const migration0012Tournaments = {
  id: '0012_tournaments',
  sql: `
CREATE TABLE IF NOT EXISTS tournaments (
  id                TEXT PRIMARY KEY NOT NULL,
  game_id           TEXT NOT NULL REFERENCES games(id) ON DELETE RESTRICT,
  name_ar           TEXT NOT NULL,
  description_ar    TEXT,
  image_url         TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','active','completed','cancelled')),
  max_participants  INTEGER,
  starts_at         INTEGER,
  ends_at           INTEGER,
  created_by        TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tournaments_game ON tournaments(game_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
CREATE INDEX IF NOT EXISTS idx_tournaments_starts ON tournaments(starts_at);
`,
};