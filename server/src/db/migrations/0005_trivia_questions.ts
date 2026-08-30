/**
 * Phase B3.1 — Trivia Question Bank (additive).
 *
 * Scalable SQLite-backed question storage replacing the JSON import.
 * Does NOT delete or modify the existing trivia-questions.json.
 */
export const migration0005TriviaQuestions = {
  id: '0005_trivia_questions',
  sql: `
CREATE TABLE IF NOT EXISTS trivia_questions (
  id           TEXT PRIMARY KEY NOT NULL,
  question     TEXT NOT NULL,
  choices      TEXT NOT NULL,          -- JSON array of exactly 4 strings
  correct_idx  INTEGER NOT NULL CHECK (correct_idx BETWEEN 0 AND 3),
  category     TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('سهل', 'متوسط', 'صعب')),
  tags         TEXT NOT NULL DEFAULT '[]',       -- JSON array of strings
  source       TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,       -- 0 or 1
  language     TEXT NOT NULL DEFAULT 'ar',
  hash         TEXT NOT NULL UNIQUE,             -- content hash for duplicate prevention
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Indexes for scalable retrieval
CREATE INDEX IF NOT EXISTS idx_trivia_category ON trivia_questions(category);
CREATE INDEX IF NOT EXISTS idx_trivia_difficulty ON trivia_questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_trivia_verified ON trivia_questions(verified);
CREATE INDEX IF NOT EXISTS idx_trivia_category_difficulty ON trivia_questions(category, difficulty);
CREATE INDEX IF NOT EXISTS idx_trivia_language ON trivia_questions(language);
`,
};