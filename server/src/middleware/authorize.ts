import type { Request, Response, NextFunction } from 'express';
import { resolveSession, type SessionUser } from '../auth/session';
import type { AdminPermission } from '../auth/adminPermissions';

/**
 * Admin Control & Permissions — centralized HTTP authorization.
 *
 * Security boundary rules:
 * - `requireAdmin`      → any admin account (SUPER or LIMITED). View-level gate.
 * - `requireSuperAdmin` → SUPER_ADMIN only (full administration).
 * - `requirePermission` → SUPER_ADMIN always, or a LIMITED_ADMIN that has been
 *   explicitly granted the named permission by a SUPER_ADMIN.
 *
 * Authorization is always resolved from the server-side session, never from
 * client-supplied headers/body. Non-admins and limited admins without the
 * permission receive 403 even when calling the API directly.
 */

export interface ResolvedAdminAccess {
  user: SessionUser;
  isSuper: boolean;
  canCreateTournaments: boolean;
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized' });
}

function forbidden(res: Response): void {
  res.status(403).json({ error: 'forbidden' });
}

/** Any authenticated admin (SUPER or LIMITED). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = resolveSession(req);
  if (!user) {
    unauthorized(res);
    return;
  }
  if (user.role !== 'admin') {
    forbidden(res);
    return;
  }
  next();
}

/** SUPER_ADMIN only. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = resolveSession(req);
  if (!user) {
    unauthorized(res);
    return;
  }
  if (user.role !== 'admin') {
    forbidden(res);
    return;
  }
  if (user.adminTier !== 'super') {
    forbidden(res);
    return;
  }
  next();
}

function hasPermission(access: ResolvedAdminAccess, permission: AdminPermission): boolean {
  if (access.isSuper) return true;
  switch (permission) {
    case 'can_create_tournaments':
      return access.canCreateTournaments;
    default:
      return false;
  }
}

/**
 * SUPER_ADMIN always passes; a LIMITED_ADMIN passes only with the explicit
 * permission. Returns 401/403 consistently with `requireAdmin`.
 */
export function requirePermission(permission: AdminPermission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = resolveSession(req);
    if (!user) {
      unauthorized(res);
      return;
    }
    if (user.role !== 'admin') {
      forbidden(res);
      return;
    }
    const access: ResolvedAdminAccess = {
      user,
      isSuper: user.adminTier === 'super',
      canCreateTournaments: user.permissions?.canCreateTournaments === true,
    };
    if (!hasPermission(access, permission)) {
      forbidden(res);
      return;
    }
    next();
  };
}
