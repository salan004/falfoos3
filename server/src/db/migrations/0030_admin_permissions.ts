/**
 * Admin Control & Permissions — moderator system (additive).
 *
 * Adds a dedicated `admin_permissions` table that records the administrative
 * tier and granular permissions for each admin account WITHOUT touching the
 * existing `users.role` CHECK constraint (still limited to 'user' | 'admin').
 *
 * Model:
 * - SUPER_ADMIN  → `is_super = 1`
 * - LIMITED_ADMIN → `is_super = 0` (granted only `can_create_tournaments` when allowed)
 *
 * Backfill: every account that is currently `role = 'admin'` (i.e. every
 * existing administrator, including those bootstrapped via ADMIN_EMAILS) is
 * seeded as a SUPER_ADMIN with `can_create_tournaments = 1`, preserving their
 * current full access exactly. No user, guest, player or tournament data is
 * created, modified or removed.
 *
 * Admins created later by the ADMIN_EMAILS bootstrap are re-seeded as super by
 * `bootstrapAdminRole`; limited admins always receive an explicit row via the
 * moderator management API.
 */
export const migration0030AdminPermissions = {
  id: '0030_admin_permissions',
  sql: `
CREATE TABLE IF NOT EXISTS admin_permissions (
  user_id                TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_super               INTEGER NOT NULL DEFAULT 0 CHECK (is_super IN (0, 1)),
  can_create_tournaments INTEGER NOT NULL DEFAULT 0 CHECK (can_create_tournaments IN (0, 1)),
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL,
  updated_by             TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_permissions_super ON admin_permissions(is_super);

-- Backfill: existing admins keep their current (full) behavior as SUPER_ADMIN.
INSERT OR IGNORE INTO admin_permissions
  (user_id, is_super, can_create_tournaments, created_at, updated_at, updated_by)
SELECT
  id,
  1,
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  NULL
FROM users
WHERE role = 'admin';
`,
};
