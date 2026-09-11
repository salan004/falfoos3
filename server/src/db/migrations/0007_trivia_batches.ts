/**
 * Phase T2.2 — Trivia Batch Management (additive).
 *
 * Tracks batches of trivia questions for scalable dataset expansion.
 * Does NOT modify trivia_questions table.
 */
export const migration0007TriviaBatches = {
  id: '0007_trivia_batches',
  sql: `
CREATE TABLE IF NOT EXISTS trivia_batches (
  id           TEXT PRIMARY KEY NOT NULL,
  name         TEXT NOT NULL,
  batch_number INTEGER NOT NULL UNIQUE,
  status       TEXT NOT NULL CHECK (status IN ('DRAFT', 'VALIDATING', 'VALIDATED', 'RECONCILED', 'APPROVED', 'IMPORTED', 'REJECTED')),
  question_count INTEGER NOT NULL DEFAULT 0,
  validation_report TEXT,
  import_report TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trivia_batches_status ON trivia_batches(status);
CREATE INDEX IF NOT EXISTS idx_trivia_batches_batch_number ON trivia_batches(batch_number);
`,
};