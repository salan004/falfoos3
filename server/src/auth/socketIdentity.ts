import type { Socket } from 'socket.io';
import { getDb } from '../db/db';
import { COOKIE_NAME, parseCookieHeader, resolveSessionBySid, type SessionUser } from './session';
import { resolveVerifiedGuestId } from './guest';

/**
 * Phase 11E — server-authoritative socket identity.
 *
 * Every Socket.IO handshake is resolved from HTTP cookies ONLY:
 *   falfoos_session → registered user (DB-checked: expiry + revocation)
 *   falfoos_guest   → stable anonymous guest (row must exist)
 * Connections carrying neither are REJECTED with 'identity-required'; the
 * client recovers by fetching GET /api/guest/identity and reconnecting.
 *
 * The client can NEVER choose its canonical player id. For chat messages the
 * server overrides any client-supplied authorId with the verified identity
 * (override+warn policy — locked decision).
 */

export const USER_PLAYER_PREFIX = 'user:';

export interface SocketIdentity {
  /** Canonical guests.player_id backing this connection (scoring identity). */
  canonicalPlayerId: string;
  kind: 'user' | 'guest';
  userId?: string;
  role?: 'user' | 'admin';
  guestId?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

/**
 * Resolves the canonical Player for an authenticated account.
 *
 * Phase 7 change — an authenticated account with NO claimed Player is now an
 * INCOMPLETE account: it must NOT auto-create a `user:<id>` Player. The
 * function returns the claimed Player id, or `null` when none is linked.
 *
 * Accounts created before Phase 7 that already own a `user:<id>` row still
 * match the `claimed_user_id` lookup and keep working unchanged. Only the
 * silent creation of new synthetic Players is removed.
 *
 * Phase 12B — exported so HTTP routes (/api/me/profile) resolve the SAME
 * canonical scoring id as the socket handshake. Single source of truth.
 */
export function ensureUserCanonicalPlayer(user: SessionUser): string | null {
  const claimed = getDb()
    .prepare('SELECT player_id FROM guests WHERE claimed_user_id = ? ORDER BY first_seen ASC LIMIT 1')
    .get(user.id) as { player_id: string } | undefined;
  return claimed ? claimed.player_id : null;
}

/** True when the account already owns a canonical Player (linked/complete). */
export function isAccountLinked(userId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 AS ok FROM guests WHERE claimed_user_id = ? LIMIT 1')
    .get(userId);
  return Boolean(row);
}

/**
 * Resolves a verified identity from raw handshake cookies, or null when the
 * connection must be rejected.
 */
export function resolveSocketIdentity(cookieHeader: string | undefined): SocketIdentity | null {
  const cookies = parseCookieHeader(cookieHeader);

  // Expired/revoked/garbage sessions degrade to guest — never error out.
  const user = resolveSessionBySid(cookies[COOKIE_NAME]);
  const guestId = resolveVerifiedGuestId(cookies['falfoos_guest']);

  if (!user && !guestId) return null;

  if (user) {
    const canonicalPlayerId = ensureUserCanonicalPlayer(user);
    if (canonicalPlayerId) {
      return {
        canonicalPlayerId,
        kind: 'user',
        userId: user.id,
        role: user.role,
        guestId: guestId ?? undefined,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      };
    }
    // Phase 7 — incomplete account (signed in, no linked Player). Fall back
    // to the verified guest identity; never mint a synthetic Player.
  }

  // Guest identity (anonymous visitor, OR an incomplete authenticated account).
  if (!guestId) return null;

  const row = getDb()
    .prepare('SELECT display_name, avatar_url FROM guests WHERE player_id = ?')
    .get(guestId) as { display_name: string; avatar_url: string | null } | undefined;

  return {
    canonicalPlayerId: guestId,
    kind: 'guest',
    guestId,
    displayName: row?.display_name || 'زائر',
    avatarUrl: row?.avatar_url ?? null,
  };
}

/** Attaches the frozen, server-owned identity during the handshake. */
export function attachSocketIdentity(socket: Socket): void {
  socket.data.identity = Object.freeze(
    resolveSocketIdentity(socket.handshake.headers.cookie)
  );
}

/**
 * Phase 11E — chat identity enforcement. Returns the AUTHORITATIVE author id
 * for this socket's message and flags impersonation attempts loudly.
 */
export function authoritativeAuthorId(
  socket: Socket,
  clientAuthorId: unknown
): string | undefined {
  const identity = socket.data.identity as SocketIdentity | undefined;
  if (!identity) return undefined;
  if (
    typeof clientAuthorId === 'string' &&
    clientAuthorId.length > 0 &&
    clientAuthorId !== identity.canonicalPlayerId
  ) {
    console.warn(
      `[Falfoos] Identity override on chat:message socket=${socket.id} claimed=${clientAuthorId} using=${identity.canonicalPlayerId}`
    );
  }
  return identity.canonicalPlayerId;
}
