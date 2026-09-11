/**
 * Phase T2.3 — Trivia Category Taxonomy (additive).
 *
 * Creates canonical category registry for Trivia questions.
 * Does NOT modify existing questions.
 */
export const migration0009TriviaCategories = {
  id: '0009_trivia_categories',
  sql: `
CREATE TABLE IF NOT EXISTS trivia_categories (
  id           TEXT PRIMARY KEY NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  name_ar      TEXT NOT NULL UNIQUE,
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trivia_categories_slug ON trivia_categories(slug);
CREATE INDEX IF NOT EXISTS idx_trivia_categories_is_active ON trivia_categories(is_active);
CREATE INDEX IF NOT EXISTS idx_trivia_categories_sort_order ON trivia_categories(sort_order);

-- Seed canonical categories
INSERT OR IGNORE INTO trivia_categories (id, slug, name_ar, description, sort_order, is_active, created_at, updated_at) VALUES
  ('history', 'history', 'تاريخ', 'Historical events, civilizations, figures, wars', 1, 1, 0, 0),
  ('geography', 'geography', 'جغرافيا', 'Countries, capitals, geography, landmarks', 2, 1, 0, 0),
  ('science', 'science', 'علوم', 'Physics, chemistry, biology, mathematics', 3, 1, 0, 0),
  ('arts_literature', 'arts_literature', 'فنون وآداب', 'Literature, art, cinema, music', 4, 1, 0, 0),
  ('sports', 'sports', 'رياضة', 'Sports, athletes, competitions', 5, 1, 0, 0),
  ('technology_space', 'technology_space', 'تقنية وفضاء', 'Technology, computing, AI, space exploration', 6, 1, 0, 0),
  ('video_games', 'video_games', 'ألعاب فيديو', 'Video games, studios, consoles, esports', 7, 1, 0, 0),
  ('general_knowledge', 'general_knowledge', 'ثقافة عامة', 'Knowledge not fitting another canonical category', 8, 1, 0, 0);
`,
};