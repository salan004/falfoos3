import crypto from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/db';
import { env, isProduction } from '../config/env';

/**
 * Phase 11C — opaque browser sessions backed by the Phase 11B `sessions` table.
 *
 * - cookie value = 256-bit random id; the id IS the credential (no signing secret needed)
 * - httpOnly + SameSite=None; Secure (cross-site authentication for Vercel + VPS)
 * - sliding idle expiry (30d) clamped by an absolute lifetime (90d from created_at)
 * - revocation via revoked_at, checked on every lookup
 */

const COOKIE_NAME = 'falfoos_session';
const IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const ABSOLUTE_MS = 90 * 24 * 60 * 60 * 1000;
const OAUTH_STATE_COOKIE = 'falfoos_oauth_state';
const OAUTH_VERIFIER_COOKIE = 'falfoos_oauth_verifier';

export interface SessionUser {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  role: 'user' | 'admin';
}

// isProduction() comes from the centralized config layer (Phase 19).

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'none' as const,
    secure: true,
    path: '/',
  };
}

/**
 * Minimal zero-dependency cookie parsing. Phase 11E exports the string-based
 * form so the Socket.IO handshake (plain header, no express Request) can
 * reuse the exact same logic as HTTP routes.
 */
export function parseCookieHeader(raw: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (!raw) return jar;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      jar[name] = decodeURIComponent(value);
    } catch {
      jar[name] = value;
    }
  }
  return jar;
}

export function readCookie(req: Request, name: string): string | undefined {
  return parseCookieHeader(req.headers.cookie)[name];
}

export function setOAuthFlowCookies(res: Response, state: string, codeVerifier: string): void {
  const opts = { ...baseCookieOptions(), maxAge: 10 * 60 * 1000 };
  res.cookie(OAUTH_STATE_COOKIE, state, opts);
  res.cookie(OAUTH_VERIFIER_COOKIE, codeVerifier, opts);
}

export function readOAuthFlow(req: Request): { state?: string; codeVerifier?: string } {
  return {
    state: readCookie(req, OAUTH_STATE_COOKIE),
    codeVerifier: readCookie(req, OAUTH_VERIFIER_COOKIE),
  };
}

export function clearOAuthFlowCookies(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, baseCookieOptions());
  res.clearCookie(OAUTH_VERIFIER_COOKIE, baseCookieOptions());
}

export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(COOKIE_NAME, sessionId, { ...sessionCookieOptions(), maxAge: ABSOLUTE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, sessionCookieOptions());
}

/**
 * Phase 11F — first-admin bootstrap. When ADMIN_EMAILS is configured, a
 * Google login whose VERIFIED account email matches an entry is granted
 * role='admin' (upgrade-only: existing admins are never demoted here).
 * The email itself is never stored or logged.
 */
function bootstrapAdminRole(userId: string, currentRole: 'user' | 'admin', email?: string): void {
  if (!email || currentRole === 'admin') return;
  // Phase 19 — allow-list flows through the centralized config layer.
  const allowList = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (allowList.length === 0 || !allowList.includes(email.toLowerCase())) return;

  getDb().prepare('UPDATE users SET role = ? WHERE id = ?').run('admin', userId);
  console.log(`[Falfoos] Admin role granted via ADMIN_EMAILS bootstrap (user ${userId})`);
}

/** Create-or-update the local user for a verified Google identity. */
export function upsertGoogleUser(profile: {
  sub: string;
  name?: string;
  picture?: string;
  email?: string;
}): SessionUser {
  const db = getDb();
  const now = Date.now();
  const displayName = profile.name?.trim() || 'لاعب FalFoos';

  const existing = db
    .prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND provider_uid = ?')
    .get('google', profile.sub) as { user_id: string } | undefined;

  let userId: string;
  if (!existing) {
    userId = crypto.randomUUID();
    db.prepare(
      'INSERT INTO users (id, display_name, avatar_url, role, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(userId, displayName, profile.picture ?? null, 'user', now);
    db.prepare('INSERT INTO auth_identities VALUES (?, ?, ?, ?)').run('google', profile.sub, userId, now);
  } else {
    userId = existing.user_id;
    // Keep the local profile fresh from Google each login.
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(
      displayName,
      profile.picture ?? null,
      userId
    );
  }

  const user = db
    .prepare('SELECT id, display_name, avatar_url, role FROM users WHERE id = ?')
    .get(userId) as { id: string; display_name: string; avatar_url: string | null; role: 'user' | 'admin' };

  bootstrapAdminRole(user.id, user.role, profile.email);

  // Re-read in case the bootstrap upgraded the role this same call.
  if (user.role === 'user') {
    const refreshed = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as
      | { role: 'user' | 'admin' }
      | undefined;
    if (refreshed) user.role = refreshed.role;
  }

  return { id: user.id, displayName: user.display_name, avatarUrl: user.avatar_url, role: user.role };
}

export function createSession(res: Response, userId: string): void {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    now,
    now + IDLE_MS
  );
  setSessionCookie(res, id);
}

export function resolveSession(req: Request): SessionUser | null {
  return resolveSessionBySid(readCookie(req, COOKIE_NAME));
}

/**
 * Phase 11E — session resolution by raw id, shared by HTTP routes and the
 * Socket.IO handshake middleware. Validates expiry + revocation every call.
 */
export function resolveSessionBySid(sid: string | undefined): SessionUser | null {
  if (!sid) return null;

  const db = getDb();
  const now = Date.now();

  const row = db
    .prepare(
      `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.revoked_at,
              u.display_name, u.avatar_url, u.role, u.disabled_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(sid) as
    | {
        user_id: string;
        created_at: number;
        expires_at: number;
        revoked_at: number | null;
        display_name: string;
        avatar_url: string | null;
        role: 'user' | 'admin';
        disabled_at: number | null;
      }
    | undefined;

  if (!row) return null;
  if (row.revoked_at !== null || row.disabled_at !== null) return null;
  if (row.expires_at < now) return null;
  if (row.created_at + ABSOLUTE_MS < now) return null;

  // Sliding idle window, clamped to the absolute lifetime.
  const nextExpiry = Math.min(now + IDLE_MS, row.created_at + ABSOLUTE_MS);
  if (nextExpiry !== row.expires_at) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(nextExpiry, sid);
  }

  return {
    id: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    role: row.role,
  };
}

/** Revokes the current session (kept in table for audit) and clears the cookie. */
export function revokeCurrentSession(req: Request, res: Response): void {
  const sid = readCookie(req, COOKIE_NAME);
  if (sid) {
    getDb()
      .prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(Date.now(), sid);
  }
  clearSessionCookie(res);
}

export { COOKIE_NAME };
