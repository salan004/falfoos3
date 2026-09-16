/**
 * Phase 3 — Games table (additive).
 *
 * Database-backed game metadata replacing the hardcoded client catalog.
 * Does NOT modify existing gameplay systems.
 */
export const migration0011Games = {
  id: '0011_games',
  sql: `
CREATE TABLE IF NOT EXISTS games (
  id           TEXT PRIMARY KEY NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  name_ar      TEXT NOT NULL,
  description_ar TEXT,
  image_url    TEXT,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_active ON games(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug);
`,
};