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
 * Authenticated players score under ONE stable id:
 * - claimed user  → their CLAIMED guest row (history continuity, Option A)
 * - unclaimed user→ a dedicated `user:<id>` guests row minted on first connect
 *
 * Phase 12B — exported so HTTP routes (/api/me/profile) resolve the SAME
 * canonical scoring id as the socket handshake. Single source of truth.
 */
export function ensureUserCanonicalPlayer(user: SessionUser): string {
  const db = getDb();
  const now = Date.now();

  const claimed = db
    .prepare('SELECT player_id FROM guests WHERE claimed_user_id = ? ORDER BY first_seen ASC LIMIT 1')
    .get(user.id) as { player_id: string } | undefined;
  if (claimed) return claimed.player_id;

  const playerId = `${USER_PLAYER_PREFIX}${user.id}`;
  db.prepare(
    `INSERT INTO guests (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO NOTHING`
  ).run(playerId, user.displayName, user.avatarUrl ?? null, now, now, user.id);
  return playerId;
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

  const row = getDb()
    .prepare('SELECT display_name, avatar_url FROM guests WHERE player_id = ?')
    .get(guestId) as { display_name: string; avatar_url: string | null } | undefined;

  return {
    canonicalPlayerId: guestId!,
    kind: 'guest',
    guestId: guestId!,
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
