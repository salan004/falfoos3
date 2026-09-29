import { getDb } from '../db/db';

/**
 * Admin Control & Permissions — data access for the `admin_permissions` table.
 *
 * `admin_permissions` is the single source of truth for the administrative
 * TIER and granular permissions. `users.role` stays the coarse "is this an
 * admin account" gate ('user' | 'admin') and is never extended.
 *
 * SUPER_ADMIN is EXPLICIT: it requires an `admin_permissions` row with
 * `is_super = 1`. Every existing admin is backfilled as SUPER_ADMIN by
 * migration 0030 and ADMIN_EMAILS bootstraps a super row, so normal operation
 * is unchanged. A `role = 'admin'` account with NO permissions row is NOT a
 * super admin (no fail-open) — it resolves to a non-super, no-permission state.
 */

export const ADMIN_PERMISSIONS = ['can_create_tournaments'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export interface AdminAccess {
  isSuper: boolean;
  canCreateTournaments: boolean;
}

export interface ModeratorRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  canCreateTournaments: boolean;
}

export interface PromotableUserRow {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

interface PermissionRecord {
  is_super: number;
  can_create_tournaments: number;
}

const SELECT_PERMISSION = 'SELECT is_super, can_create_tournaments FROM admin_permissions WHERE user_id = ?';

/**
 * Resolve the effective admin access for a user. Returns null for non-admins
 * (role !== 'admin').
 *
 * SECURITY: there is NO fail-open. `users.role = 'admin'` alone is never
 * sufficient for SUPER_ADMIN. SUPER_ADMIN exists only when an explicit
 * `admin_permissions` row has `is_super = 1` (created by the ADMIN_EMAILS
 * bootstrap, by migration 0030's backfill, or by a trusted super admin).
 * An admin account with no row resolves to a non-super, no-permission state.
 */
export function getAdminAccess(userId: string, role: string): AdminAccess | null {
  if (role !== 'admin') return null;
  const row = getDb().prepare(SELECT_PERMISSION).get(userId) as PermissionRecord | undefined;
  if (!row) return { isSuper: false, canCreateTournaments: false };
  return {
    isSuper: row.is_super === 1,
    canCreateTournaments: row.can_create_tournaments === 1,
  };
}

function upsertPermission(
  userId: string,
  isSuper: boolean,
  canCreateTournaments: boolean,
  updatedBy: string | null
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO admin_permissions
         (user_id, is_super, can_create_tournaments, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         is_super = excluded.is_super,
         can_create_tournaments = excluded.can_create_tournaments,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    )
    .run(userId, isSuper ? 1 : 0, canCreateTournaments ? 1 : 0, now, now, updatedBy);
}

/**
 * Idempotently ensures an account holds full SUPER_ADMIN access. Used by the
 * ADMIN_EMAILS bootstrap so a bootstrapped admin always has an explicit row.
 */
export function ensureSuperAdmin(userId: string, updatedBy: string | null = null): void {
  upsertPermission(userId, true, true, updatedBy);
}

/** List every LIMITED_ADMIN (all non-super admins with a row). */
export function listModerators(): ModeratorRow[] {
  const rows = getDb()
    .prepare(
      `SELECT u.id AS user_id, u.display_name, u.avatar_url, p.can_create_tournaments
         FROM admin_permissions p
         JOIN users u ON u.id = p.user_id
        WHERE p.is_super = 0 AND u.role = 'admin'
        ORDER BY u.display_name COLLATE NOCASE ASC`
    )
    .all() as {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    can_create_tournaments: number;
  }[];
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    canCreateTournaments: r.can_create_tournaments === 1,
  }));
}

/** Fetch a single moderator (limited admin) row, or null when not one. */
export function getModerator(userId: string): ModeratorRow | null {
  const row = getDb()
    .prepare(
      `SELECT u.id AS user_id, u.display_name, u.avatar_url, p.can_create_tournaments
         FROM admin_permissions p
         JOIN users u ON u.id = p.user_id
        WHERE p.user_id = ? AND p.is_super = 0 AND u.role = 'admin'`
    )
    .get(userId) as
    | {
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        can_create_tournaments: number;
      }
    | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    canCreateTournaments: row.can_create_tournaments === 1,
  };
}

/**
 * Case-insensitive search over EXISTING users eligible for promotion
 * (role = 'user'). Deliberately exposes only id / display name / avatar —
 * never emails, sessions or player identities.
 */
export function searchPromotableUsers(query: string, limit = 20): PromotableUserRow[] {
  const trimmed = query.trim();
  const capped = Math.max(1, Math.min(50, Math.floor(limit)));
  const db = getDb();
  const rows = trimmed
    ? (db
        .prepare(
          `SELECT id, display_name, avatar_url
             FROM users
            WHERE role = 'user' AND (display_name LIKE ? OR id = ?)
            ORDER BY display_name COLLATE NOCASE ASC
            LIMIT ?`
        )
        .all(`%${trimmed}%`, trimmed, capped) as {
        id: string;
        display_name: string;
        avatar_url: string | null;
      }[])
    : (db
        .prepare(
          `SELECT id, display_name, avatar_url
             FROM users
            WHERE role = 'user'
            ORDER BY created_at DESC
            LIMIT ?`
        )
        .all(capped) as { id: string; display_name: string; avatar_url: string | null }[]);
  return rows.map((r) => ({ userId: r.id, displayName: r.display_name, avatarUrl: r.avatar_url }));
}

export interface PromoteResult {
  ok: boolean;
  error?: 'user_not_found' | 'already_super' | 'already_moderator';
  moderator?: ModeratorRow;
}

/**
 * Promote an EXISTING user to LIMITED_ADMIN. Never creates a user, guest or
 * player: it only flips `users.role` to 'admin' and writes a limited
 * permissions row with `can_create_tournaments = 0`.
 */
export function promoteToLimitedAdmin(userId: string, updatedBy: string | null): PromoteResult {
  const db = getDb();
  const tx = db.transaction((): PromoteResult => {
    const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId) as
      | { id: string; role: string }
      | undefined;
    if (!user) return { ok: false, error: 'user_not_found' };

    const existing = db.prepare(SELECT_PERMISSION).get(userId) as PermissionRecord | undefined;
    if (existing && existing.is_super === 1) return { ok: false, error: 'already_super' };
    if (existing && existing.is_super === 0) return { ok: false, error: 'already_moderator' };

    // Only ever upgrades a plain user — a role='admin' account with no row is
    // treated as super and never silently demoted here.
    if (user.role === 'admin') return { ok: false, error: 'already_super' };

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', userId);
    upsertPermission(userId, false, false, updatedBy);
    return { ok: true, moderator: getModerator(userId) ?? undefined };
  });
  return tx();
}

export function setCanCreateTournaments(
  userId: string,
  canCreate: boolean,
  updatedBy: string | null
): ModeratorRow | null {
  const moderator = getModerator(userId);
  if (!moderator) return null;
  upsertPermission(userId, false, canCreate, updatedBy);
  return getModerator(userId);
}

export interface DemoteResult {
  ok: boolean;
  error?: 'moderator_not_found';
}

/**
 * Remove LIMITED_ADMIN access: demote `users.role` back to 'user' and drop the
 * permissions row. Player/guest/Google identities are never touched.
 */
export function demoteModerator(userId: string): DemoteResult {
  const db = getDb();
  const tx = db.transaction((): DemoteResult => {
    const moderator = getModerator(userId);
    if (!moderator) return { ok: false, error: 'moderator_not_found' };
    db.prepare('DELETE FROM admin_permissions WHERE user_id = ?').run(userId);
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('user', userId);
    return { ok: true };
  });
  return tx();
}
