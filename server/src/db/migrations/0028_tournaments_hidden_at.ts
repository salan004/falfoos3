/**
 * R5 — tournament visual hide / archive (additive, non-destructive).
 *
 * Visibility is an axis STRICTLY SEPARATE from the competitive lifecycle
 * (`status`). Hiding a tournament never changes its lifecycle status and never
 * deletes data: it only removes the tournament from normal listings/discovery.
 *
 * Both columns are nullable and defaultless, so every existing tournament is
 * visible (`hidden_at IS NULL`) with no data rewrite. Restoring clears the
 * columns. There is intentionally no `archived`/`hidden` status value.
 */
export const migration0028TournamentsHiddenAt = {
  id: '0028_tournaments_hidden_at',
  sql: `
ALTER TABLE tournaments ADD COLUMN hidden_at INTEGER;
ALTER TABLE tournaments ADD COLUMN hidden_by TEXT;

CREATE INDEX IF NOT EXISTS idx_tournaments_hidden ON tournaments(hidden_at);
`,
};
