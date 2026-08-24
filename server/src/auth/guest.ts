import crypto from 'crypto';
import type { Request, Response } from 'express';
import { getDb } from '../db/db';
import { readCookie } from './session';
import { isProduction } from '../config/env';

/**
 * Phase 11D — stable anonymous guest identity.
 *
 * The SERVER issues a UUIDv4 and stores it in an httpOnly `falfoos_guest`
 * cookie (1 year). The client never chooses, reads or needs the value —
 * it only triggers issuance once per page load via GET /api/guest/identity.
 *
 * Separation of concerns (must stay independent):
 *   falfoos_session ≠ falfoos_guest ≠ game sessionId ≠ Socket.IO connection.
 * Login/logout NEVER touch the guest cookie: guests remain first-class
 * players with or without a Google account.
 */

/** Phase 12B — exported so HTTP routes share the exact cookie name. */
export const GUEST_COOKIE = 'falfoos_guest';
const GUEST_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// isProduction() comes from the centralized config layer (Phase 19).

function setGuestCookie(res: Response, playerId: string): void {
  res.cookie(GUEST_COOKIE, playerId, {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: GUEST_TTL_MS,
  });
}

function guestRowExists(playerId: string): boolean {
  return !!getDb().prepare('SELECT player_id FROM guests WHERE player_id = ?').get(playerId);
}

function insertGuest(playerId: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO guests (player_id, display_name, avatar_url, first_seen, last_seen) VALUES (?, ?, NULL, ?, ?)'
    )
    .run(playerId, 'زائر', now, now);
}

/**
 * Read-only identity resolution for future consumers (Phase 11E socket
 * handshake). Returns the stable guest id when a valid cookie is present;
 * never creates rows or cookies.
 */
export function resolveGuestIdentity(req: Request): { playerId?: string; source: 'guest-cookie' | null } {
  const raw = readCookie(req, GUEST_COOKIE);
  if (raw && UUID_RE.test(raw)) {
    return { playerId: raw.toLowerCase(), source: 'guest-cookie' };
  }
  return { source: null };
}

/**
 * Phase 11E — verified guest id from a RAW cookie value (handshake path).
 * The cookie alone is not trusted: the row must exist. Returns null for
 * missing/malformed/orphaned ids.
 */
export function resolveVerifiedGuestId(cookieValue: string | undefined): string | null {
  if (!cookieValue || !UUID_RE.test(cookieValue)) return null;
  const id = cookieValue.toLowerCase();
  return guestRowExists(id) ? id : null;
}

/**
 * Ensures the request carries a stable guest identity: reuses the existing
 * cookie when valid (touching last_seen), otherwise issues a brand-new one.
 * Returns the canonical guest player id.
 */
export function ensureGuestIdentity(req: Request, res: Response): string {
  const existing = resolveGuestIdentity(req);

  if (existing.playerId && guestRowExists(existing.playerId)) {
    // Throttle last_seen writes to at most once per minute per visitor.
    const db = getDb();
    const row = db.prepare('SELECT last_seen FROM guests WHERE player_id = ?').get(existing.playerId) as
      | { last_seen: number }
      | undefined;
    if (row && Date.now() - row.last_seen > 60_000) {
      db.prepare('UPDATE guests SET last_seen = ? WHERE player_id = ?').run(Date.now(), existing.playerId);
    }
    setGuestCookie(res, existing.playerId);
    return existing.playerId;
  }

  // Missing / malformed cookie or orphaned id (e.g. cookies cleared):
  // issue a FRESH identity. The old row is never deleted — history stays.
  const playerId = crypto.randomUUID();
  insertGuest(playerId);
  setGuestCookie(res, playerId);
  console.log(`[Falfoos] Guest identity issued: ${playerId}`);
  return playerId;
}
