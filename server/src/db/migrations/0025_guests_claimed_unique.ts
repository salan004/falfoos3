/**
 * Phase 7 — enforce one website user per Player (additive).
 *
 * Promotes the invariant already relied on by account-linking
 * (`UPDATE ... WHERE claimed_user_id IS NULL`) into a database constraint:
 * a non-NULL `claimed_user_id` may be attached to at most one guest row.
 *
 * PARTIAL unique index so the 312 legitimately unclaimed guest rows (NULL)
 * keep coexisting; SQLite treats NULLs as distinct, but the explicit
 * `WHERE claimed_user_id IS NOT NULL` also keeps the index small and
 * self-documenting. Mirrors the existing `idx_guests_yt_channel` pattern.
 *
 * Production data was verified read-only: 8 claimed rows,
 * 0 duplicate claimed_user_id values. No rows are modified here.
 */
export const migration0025GuestsClaimedUnique = {
  id: '0025_guests_claimed_unique',
  sql: `
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_claimed_unique
  ON guests(claimed_user_id)
  WHERE claimed_user_id IS NOT NULL;
`,
};
