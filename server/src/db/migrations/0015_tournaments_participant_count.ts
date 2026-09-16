/**
 * Phase 3C — Add participant_count to tournaments for atomic capacity enforcement.
 *
 * Adding a denormalized participant_count column allows atomic capacity enforcement
 * using a single UPDATE with a CHECK constraint or a WHERE clause that prevents
 * exceeding max_participants in a single atomic operation.
 */
export const migration0015TournamentsParticipantCount = {
  id: '0015_tournaments_participant_count',
  sql: `
-- Add participant_count column for atomic capacity tracking
ALTER TABLE tournaments ADD COLUMN participant_count INTEGER NOT NULL DEFAULT 0;

-- Add check constraint to enforce capacity at database level
-- Note: SQLite doesn't support CHECK constraints with subqueries,
-- so we enforce capacity atomically in the application using UPDATE with WHERE clause
`,
};