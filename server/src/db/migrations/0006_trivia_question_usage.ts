/**
 * Phase B3.2 — Cross-Match Question Rotation (additive).
 *
 * Tracks when each trivia question was last used across matches.
 * Never modifies trivia_questions table.
 * Safe to run multiple times.
 */
export const migration0006TriviaQuestionUsage = {
  id: '0006_trivia_question_usage',
  sql: `
CREATE TABLE IF NOT EXISTS trivia_question_usage (
  question_id   TEXT PRIMARY KEY NOT NULL REFERENCES trivia_questions(id) ON DELETE CASCADE,
  usage_count   INTEGER NOT NULL DEFAULT 1,
  last_used_at  INTEGER NOT NULL,
  last_match_id TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Indexes for efficient rotation queries
CREATE INDEX IF NOT EXISTS idx_trivia_usage_last_used ON trivia_question_usage(last_used_at);
CREATE INDEX IF NOT EXISTS idx_trivia_usage_count ON trivia_question_usage(usage_count);
`,
};