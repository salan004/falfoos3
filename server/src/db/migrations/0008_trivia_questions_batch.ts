/**
 * Phase T2.2 — Trivia Question Batch Tracking & Validation Fields (additive).
 *
 * Adds batch_id for traceability and correct_answer for validation safety.
 * Does NOT modify existing data integrity.
 */
export const migration0008TriviaQuestionsBatch = {
  id: '0008_trivia_questions_batch',
  sql: `
-- Add batch_id column for batch traceability
ALTER TABLE trivia_questions ADD COLUMN batch_id TEXT REFERENCES trivia_batches(id) ON DELETE SET NULL;

-- Add correct_answer column for validation safety (stores the actual correct answer text)
-- This enables correct_answer ↔ correct_idx validation during batch processing
ALTER TABLE trivia_questions ADD COLUMN correct_answer TEXT;

-- Index for batch queries
CREATE INDEX IF NOT EXISTS idx_trivia_questions_batch_id ON trivia_questions(batch_id);
`,
};