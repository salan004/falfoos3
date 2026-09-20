import crypto from 'crypto';
import { getDb } from '../db/db';
import { rebuildProfile } from '../competitive/CompetitiveRebuildService';

/**
 * Phase 2.x — canonical player identity resolution & reconciliation.
 *
 * ONE source of truth for turning a YouTube channel id into a canonical
 * `guests.player_id`, shared by the bot ticket webhook and the live-chat claim
 * flow. It resolves the two legitimate identity shapes a channel can have:
 *
 *   1. dedicated:  guests.youtube_channel_id = <channel>      (bot-created/claimed)
 *   2. legacy:     guests.player_id          = <channel>       (live-chat keyed),
 *                  guests.youtube_channel_id IS NULL
 *
 * Canonical rule: the dedicated row wins. If only a legacy row exists its
 * channel column is backfilled in place (no new UUID). If BOTH exist they are
 * reconciled by `mergePlayerIdentities`, preserving all history on both sides.
 *
 * All mutations run inside a single better-sqlite3 transaction (nested callers
 * use savepoints), so a failure never leaves partially migrated identity data.
 */

/** A YouTube channel id is `UC` + 22 URL-safe chars (24 total). */
const YOUTUBE_CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;

/** Informational strict check. Resolution accepts any non-empty id for
 *  backward compatibility (the deployed bot contract is unchanged). */
export function isYouTubeChannelId(value: unknown): value is string {
  return typeof value === 'string' && YOUTUBE_CHANNEL_RE.test(value);
}

/** Internal, server-issued player id shapes — never a legacy channel key. */
const INTERNAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only for a plausible legacy channel-keyed `player_id`: a YouTube channel
 * id (always starts with `UC`) that is not an internal player id. This is what
 * prevents the `player_id = ?` fallback from ever matching an arbitrary UUID.
 */
function isLegacyChannelKeyedId(value: string): boolean {
  return value.startsWith('UC') && !INTERNAL_UUID_RE.test(value) && !value.startsWith('user:');
}

function normalizeChannelId(channelId: string): string {
  if (typeof channelId !== 'string' || channelId.trim().length === 0) {
    throw new Error('identity: youtubeChannelId must be a non-empty string');
  }
  return channelId.trim();
}

interface GuestRow {
  player_id: string;
  display_name: string;
  avatar_url: string | null;
  youtube_channel_id: string | null;
  claimed_user_id: string | null;
}

const GUEST_COLUMNS = 'player_id, display_name, avatar_url, youtube_channel_id, claimed_user_id';

function getGuest(playerId: string): GuestRow | null {
  const row = getDb()
    .prepare(`SELECT ${GUEST_COLUMNS} FROM guests WHERE player_id = ?`)
    .get(playerId) as GuestRow | undefined;
  return row ?? null;
}

function findByDedicatedChannel(channelId: string): GuestRow | null {
  const row = getDb()
    .prepare(`SELECT ${GUEST_COLUMNS} FROM guests WHERE youtube_channel_id = ?`)
    .get(channelId) as GuestRow | undefined;
  return row ?? null;
}

/** Only the legacy channel-keyed shape (`player_id = <channel>`), never a UUID. */
function findLegacyChannelPlayer(channelId: string): GuestRow | null {
  if (!isLegacyChannelKeyedId(channelId)) return null;
  const row = getDb()
    .prepare(`SELECT ${GUEST_COLUMNS} FROM guests WHERE player_id = ?`)
    .get(channelId) as GuestRow | undefined;
  return row ?? null;
}

/**
 * Read-only canonical lookup. Returns the dedicated row's player id when it
 * exists, otherwise the legacy channel-keyed row's player id, otherwise null.
 * Never mutates.
 */
export function findCanonicalPlayerIdByChannel(channelId: string): string | null {
  const dedicated = findByDedicatedChannel(channelId);
  if (dedicated) return dedicated.player_id;
  return findLegacyChannelPlayer(channelId)?.player_id ?? null;
}

export interface LinkedPlayerRow {
  player_id: string;
  youtube_channel_id: string;
  display_name: string | null;
}

/**
 * Phase 8 — the SINGLE source of truth for a website user's canonical linked
 * Player.
 *
 * A canonical Player is channel-backed: it must satisfy BOTH
 * `claimed_user_id = userId` AND `youtube_channel_id IS NOT NULL`. Channel-less
 * synthetic `user:<id>` artifacts are account-identity rows, never canonical
 * links, so they are deliberately excluded here.
 *
 * Read-only: never creates, claims or mutates anything.
 */
export function findLinkedPlayerForUser(userId: string): LinkedPlayerRow | null {
  const row = getDb()
    .prepare(
      `SELECT player_id, youtube_channel_id, display_name
         FROM guests
        WHERE claimed_user_id = ? AND youtube_channel_id IS NOT NULL
        ORDER BY first_seen ASC
        LIMIT 1`
    )
    .get(userId) as LinkedPlayerRow | undefined;
  return row ?? null;
}

export interface CanonicalResolution {
  playerId: string;
  /** True only when a brand-new UUID guest was created by this call. */
  created: boolean;
  /** True when two existing identities were reconciled into one. */
  merged: boolean;
  /** The retired identity when `merged` is true. */
  mergedFrom: string | null;
}

/**
 * Resolve (or create) the single canonical player for a YouTube channel.
 * Idempotent: repeated calls for the same channel always return one player id.
 */
export function resolveOrCreatePlayerByYouTubeChannelId(
  channelId: string,
  displayName: string,
  avatarUrl?: string | null
): CanonicalResolution {
  const channel = normalizeChannelId(channelId);
  const db = getDb();
  const now = Date.now();
  const name = displayName && displayName.trim().length > 0 ? displayName.trim() : channel;

  const tx = db.transaction((): CanonicalResolution => {
    const dedicated = findByDedicatedChannel(channel);
    const legacy = findLegacyChannelPlayer(channel);

    // Both shapes exist for the same channel → reconcile (dedicated survives).
    if (dedicated && legacy && dedicated.player_id !== legacy.player_id) {
      mergePlayerIdentities(dedicated.player_id, legacy.player_id);
      return {
        playerId: dedicated.player_id,
        created: false,
        merged: true,
        mergedFrom: legacy.player_id,
      };
    }

    if (dedicated) {
      return { playerId: dedicated.player_id, created: false, merged: false, mergedFrom: null };
    }

    // Legacy row only → backfill the dedicated column in place (no new UUID).
    if (legacy) {
      db.prepare(
        'UPDATE guests SET youtube_channel_id = ?, last_seen = ? WHERE player_id = ? AND youtube_channel_id IS NULL'
      ).run(channel, now, legacy.player_id);
      return { playerId: legacy.player_id, created: false, merged: false, mergedFrom: null };
    }

    // No identity yet → create exactly one UUID guest bound to the channel.
    const playerId = crypto.randomUUID();
    db.prepare(
      `INSERT OR IGNORE INTO guests
         (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`
    ).run(playerId, name, avatarUrl ?? null, now, now, channel);

    // Lost a concurrent race for this channel — reuse the winning row.
    const created = findByDedicatedChannel(channel);
    if (!created) throw new Error('identity: failed to resolve or create guest');
    return {
      playerId: created.player_id,
      created: created.player_id === playerId,
      merged: false,
      mergedFrom: null,
    };
  });

  return tx();
}

export interface MergeOutcome {
  merged: boolean;
  survivorId: string;
  duplicateId: string;
  /** Rows whose ownership moved, per table. */
  moved: Record<string, number>;
}

/**
 * Merge `duplicateId` into `survivorId` in ONE transaction.
 *
 * History is never deleted: every reference is re-pointed where possible, a
 * conflicting (survivor already holds it) row is dropped only after the
 * equivalent survivor row is confirmed present, and competitive state is
 * re-derived from the combined immutable ledgers — never fabricated.
 */
export function mergePlayerIdentities(survivorId: string, duplicateId: string): MergeOutcome {
  if (survivorId === duplicateId) {
    throw new Error('identity: cannot merge a player into itself');
  }
  const db = getDb();

  const tx = db.transaction((): MergeOutcome => {
    const survivor = getGuest(survivorId);
    if (!survivor) throw new Error(`identity: survivor "${survivorId}" not found`);
    const duplicate = getGuest(duplicateId);
    if (!duplicate) {
      return { merged: false, survivorId, duplicateId, moved: {} };
    }

    const moved: Record<string, number> = {};

    // --- Stream Game / general history (these FKs have NO ON DELETE action) ---
    moved.score_events = db
      .prepare('UPDATE score_events SET player_id = ? WHERE player_id = ?')
      .run(survivorId, duplicateId).changes;

    moved.match_winners = moveWithPkConflict(db, 'match_winners', survivorId, duplicateId);
    moved.participations = moveWithPkConflict(db, 'participations', survivorId, duplicateId);
    moved.player_achievements = moveWithPkConflict(db, 'player_achievements', survivorId, duplicateId);
    moved.tournament_participants = moveWithPkConflict(db, 'tournament_participants', survivorId, duplicateId);
    moved.tournament_match_participants = moveWithPkConflict(
      db,
      'tournament_match_participants',
      survivorId,
      duplicateId
    );

    // --- Tournament winner + correction audit references ---
    moved.tournament_matches = db
      .prepare('UPDATE tournament_matches SET winner_player_id = ? WHERE winner_player_id = ?')
      .run(survivorId, duplicateId).changes;
    db.prepare(
      'UPDATE match_result_corrections SET previous_winner_player_id = ? WHERE previous_winner_player_id = ?'
    ).run(survivorId, duplicateId);
    db.prepare(
      'UPDATE match_result_corrections SET corrected_winner_player_id = ? WHERE corrected_winner_player_id = ?'
    ).run(survivorId, duplicateId);

    // --- Competitive ledgers (autoincrement PK; player-scoped idempotency keys) ---
    const games = collectDuplicateGames(db, duplicateId);
    moved.lp_transactions = db
      .prepare('UPDATE lp_transactions SET player_id = ? WHERE player_id = ?')
      .run(survivorId, duplicateId).changes;
    moved.elo_transactions = db
      .prepare('UPDATE elo_transactions SET player_id = ? WHERE player_id = ?')
      .run(survivorId, duplicateId).changes;

    // Drop the duplicate's materialized profiles, then rebuild the survivor's
    // from the combined immutable ledgers (composite key can never conflict).
    const deleteProfile = db.prepare('DELETE FROM competitive_profiles WHERE player_id = ? AND game_id = ?');
    for (const gameId of games) {
      deleteProfile.run(duplicateId, gameId);
      rebuildProfile(survivorId, gameId);
    }

    // Finally remove the now-orphaned duplicate guest (cascades only any
    // leftover conflict rows, all of which the survivor already holds).
    db.prepare('DELETE FROM guests WHERE player_id = ?').run(duplicateId);

    return { merged: true, survivorId, duplicateId, moved };
  });

  return tx();
}

/** Move rows that may collide on a composite PK, then drop the leftovers. */
function moveWithPkConflict(
  db: import('better-sqlite3').Database,
  table: string,
  survivorId: string,
  duplicateId: string
): number {
  const moved = db
    .prepare(`UPDATE OR IGNORE ${table} SET player_id = ? WHERE player_id = ?`)
    .run(survivorId, duplicateId).changes;
  db.prepare(`DELETE FROM ${table} WHERE player_id = ?`).run(duplicateId);
  return moved;
}

/** Every game the duplicate touched — profiles, LP ledger, or Elo ledger. */
function collectDuplicateGames(db: import('better-sqlite3').Database, duplicateId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT game_id AS game_id FROM competitive_profiles WHERE player_id = ?
        UNION
       SELECT DISTINCT game_id AS game_id FROM lp_transactions WHERE player_id = ?
        UNION
       SELECT DISTINCT game_id AS game_id FROM elo_transactions WHERE player_id = ?`
    )
    .all(duplicateId, duplicateId, duplicateId) as { game_id: string }[];
  return rows.map((r) => r.game_id);
}
