import { getDb } from '../db/db';
import crypto from 'crypto';

/**
 * Phase 3 — Tournament Participants data access.
 *
 * Uses the canonical player identity: guests.player_id
 * YouTube channel ID is the external lookup key (guests.youtube_channel_id).
 */

export interface ParticipantRow {
  tournament_id: string;
  player_id: string;
  source: 'purchase' | 'admin' | 'qualifier';
  registered_at: number;
  ticket_ref: string | null;
  status: 'registered' | 'confirmed' | 'cancelled' | 'disqualified';
}

export interface ParticipantWithProfile extends ParticipantRow {
  youtube_name: string | null;
  youtube_avatar_url: string | null;
}

export interface RegisterParticipantInput {
  tournament_id: string;
  player_id: string;
  source: 'purchase' | 'admin' | 'qualifier';
  ticket_ref?: string;
}

function rowToParticipant(row: any): ParticipantRow {
  return {
    tournament_id: row.tournament_id,
    player_id: row.player_id,
    source: row.source,
    registered_at: row.registered_at,
    ticket_ref: row.ticket_ref,
    status: row.status,
  };
}

export function getParticipantsByTournament(tournamentId: string): ParticipantWithProfile[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT tp.*, g.display_name as youtube_name, g.avatar_url as youtube_avatar_url
    FROM tournament_participants tp
    JOIN guests g ON g.player_id = tp.player_id
    WHERE tp.tournament_id = ?
    ORDER BY tp.registered_at ASC
  `).all(tournamentId);
  return rows.map((row: any) => ({
    tournament_id: row.tournament_id,
    player_id: row.player_id,
    source: row.source,
    registered_at: row.registered_at,
    ticket_ref: row.ticket_ref,
    status: row.status,
    youtube_name: row.youtube_name,
    youtube_avatar_url: row.youtube_avatar_url,
  }));
}

export function getParticipant(tournamentId: string, playerId: string): ParticipantRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND player_id = ?').get(tournamentId, playerId);
  return row ? rowToParticipant(row) : null;
}

export function getParticipantCount(tournamentId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT participant_count FROM tournaments WHERE id = ?').get(tournamentId) as { participant_count: number } | undefined;
  return row?.participant_count ?? 0;
}

export function isPlayerRegistered(tournamentId: string, playerId: string): boolean {
  return getParticipant(tournamentId, playerId) !== null;
}

export function registerParticipant(input: RegisterParticipantInput): ParticipantRow {
  const db = getDb();
  const { tournament_id, player_id, source, ticket_ref } = input;

  const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournament_id) as
    | { id: string; status: string; max_participants: number | null; game_id: string }
    | undefined;

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  if (tournament.status !== 'open') {
    throw new Error('Tournament is not open for registration');
  }

  if (tournament.max_participants !== null) {
    const currentCount = getParticipantCount(tournament_id);
    if (currentCount >= tournament.max_participants) {
      throw new Error('Tournament is full');
    }
  }

  if (isPlayerRegistered(tournament_id, player_id)) {
    throw new Error('Player already registered in this tournament');
  }

  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO tournament_participants (tournament_id, player_id, source, registered_at, ticket_ref, status)
    VALUES (?, ?, ?, ?, ?, 'registered')
  `).run(tournament_id, player_id, source, now, ticket_ref ?? null);

  if (result.changes === 0) {
    throw new Error('Failed to register participant');
  }

  // Update participant count atomically
  if (tournament.max_participants !== null) {
    db.prepare('UPDATE tournaments SET participant_count = participant_count + 1 WHERE id = ?').run(tournament_id);
  }

  return {
    tournament_id,
    player_id,
    source,
    registered_at: now,
    ticket_ref: ticket_ref ?? null,
    status: 'registered',
  };
}

export interface RegisterParticipantResult {
  success: boolean;
  error?: string;
  participant?: ParticipantRow;
}

/**
 * Transactionally register a participant with atomic capacity enforcement.
 * Uses atomic UPDATE with WHERE clause to prevent exceeding max_participants
 * under concurrent load.
 */
export function registerParticipantTransactional(
  tournamentId: string,
  playerId: string,
  source: 'purchase' | 'admin' | 'qualifier',
  ticketRef: string | null
): RegisterParticipantResult {
  const db = getDb();

  try {
    const result = db.transaction((): RegisterParticipantResult => {
      const tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tournamentId) as
        | { id: string; status: string; max_participants: number | null; game_id: string; participant_count: number }
        | undefined;

      if (!tournament) {
        return { success: false, error: 'Tournament not found' };
      }

      if (tournament.status !== 'open') {
        return { success: false, error: 'Tournament is not open for registration' };
      }

      // Increment the participant count for every successful registration —
      // including unlimited tournaments (max_participants = NULL), which must
      // still reflect their real size.
      if (tournament.max_participants !== null) {
        // Atomic capacity check and increment using single UPDATE with WHERE clause
        const updated = db.prepare(`
          UPDATE tournaments
          SET participant_count = participant_count + 1
          WHERE id = ? AND participant_count < max_participants
        `).run(tournamentId);

        if (updated.changes === 0) {
          // Capacity exceeded - the WHERE clause prevented the update
          return { success: false, error: 'Tournament is full' };
        }
      } else {
        db.prepare('UPDATE tournaments SET participant_count = participant_count + 1 WHERE id = ?').run(tournamentId);
      }

      const existing = db.prepare('SELECT * FROM tournament_participants WHERE tournament_id = ? AND player_id = ?').get(tournamentId, playerId);
      if (existing) {
        // Roll back the participant_count increment performed above.
        db.prepare('UPDATE tournaments SET participant_count = participant_count - 1 WHERE id = ?').run(tournamentId);
        return { success: false, error: 'Player already registered in this tournament' };
      }

      const now = Date.now();
      db.prepare(`
        INSERT INTO tournament_participants (tournament_id, player_id, source, registered_at, ticket_ref, status)
        VALUES (?, ?, ?, ?, ?, 'registered')
      `).run(tournamentId, playerId, source, now, ticketRef);

      return {
        success: true,
        participant: {
          tournament_id: tournamentId,
          player_id: playerId,
          source,
          registered_at: now,
          ticket_ref: ticketRef,
          status: 'registered',
        },
      };
    })();

    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Registration failed' };
  }
}

export function findPlayerByYouTubeChannelId(youtubeChannelId: string): { player_id: string } | null {
  const db = getDb();
  const row = db.prepare('SELECT player_id FROM guests WHERE youtube_channel_id = ?').get(youtubeChannelId) as { player_id: string } | undefined;
  return row ?? null;
}

/**
 * Phase 3E — resolve a tournament player by YouTube channel id, creating an
 * unclaimed Guest when the channel is not yet known.
 *
 * Safety:
 * - `guests.youtube_channel_id` is guarded by the existing UNIQUE partial index
 *   (`idx_guests_yt_channel`), so concurrent deliveries for the same channel
 *   cannot create two rows: the losing INSERT OR IGNORE is a no-op and it
 *   re-reads the winner's player_id.
 * - `claimed_user_id` is always NULL — the webhook proves a channel made a
 *   purchase, NOT ownership of a website account. The normal live-chat claiming
 *   flow can claim this exact Guest later via youtube_channel_id.
 */
export function findOrCreatePlayerByYouTubeChannelId(
  youtubeChannelId: string,
  displayName: string
): { player_id: string; created: boolean } {
  const db = getDb();
  return db.transaction((): { player_id: string; created: boolean } => {
    const existing = findPlayerByYouTubeChannelId(youtubeChannelId);
    if (existing) return { player_id: existing.player_id, created: false };

    const playerId = crypto.randomUUID();
    const now = Date.now();
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO guests
        (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
      VALUES (?, ?, NULL, ?, ?, NULL, ?)
    `).run(playerId, displayName, now, now, youtubeChannelId);

    if (inserted.changes > 0) return { player_id: playerId, created: true };

    // Lost a concurrent race for this channel — reuse the winning row.
    const raced = findPlayerByYouTubeChannelId(youtubeChannelId);
    if (raced) return { player_id: raced.player_id, created: false };
    throw new Error('Failed to resolve or create guest for YouTube channel');
  })();
}

/** Internal marker so registration failures trigger an outer rollback. */
class ParticipantRegistrationError extends Error {}

export interface TicketPurchaseRegistrationResult {
  success: boolean;
  idempotent?: boolean;
  error?: string;
  participant?: ParticipantRow;
}

/**
 * Phase 3E — atomic ticket-purchase registration.
 *
 * Resolves/creates the Guest and registers the participant in ONE transaction.
 * It reuses `registerParticipantTransactional` unchanged; when that fails for a
 * non-idempotent reason (full / not open) the whole transaction rolls back, so
 * a Guest created moments earlier is not left behind as an orphan.
 *
 * A redelivery whose participant row carries this exact `ticket_ref` is
 * reported as an idempotent success, matching the previous webhook behavior.
 */
export function registerTicketPurchaseParticipant(
  tournamentId: string,
  youtubeChannelId: string,
  displayName: string,
  eventId: string
): TicketPurchaseRegistrationResult {
  const db = getDb();
  try {
    return db.transaction((): TicketPurchaseRegistrationResult => {
      const { player_id } = findOrCreatePlayerByYouTubeChannelId(youtubeChannelId, displayName);
      const result = registerParticipantTransactional(tournamentId, player_id, 'purchase', eventId);

      if (result.success) {
        return { success: true, participant: result.participant };
      }

      const errorMsg = result.error || 'registration_failed';

      if (errorMsg.includes('already registered')) {
        const existing = getParticipant(tournamentId, player_id);
        if (existing && existing.ticket_ref === eventId) {
          return { success: true, idempotent: true, participant: existing };
        }
      }

      throw new ParticipantRegistrationError(errorMsg);
    })();
  } catch (err) {
    if (err instanceof ParticipantRegistrationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
}

export function updateParticipantStatus(tournamentId: string, playerId: string, status: ParticipantRow['status']): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE tournament_participants SET status = ? WHERE tournament_id = ? AND player_id = ?').run(status, tournamentId, playerId);
  return result.changes > 0;
}

export function cancelParticipant(tournamentId: string, playerId: string): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE tournament_participants SET status = ? WHERE tournament_id = ? AND player_id = ?').run('cancelled', tournamentId, playerId);
  if (result.changes > 0) {
    // Decrement participant count when cancelling (unlimited tournaments included).
    db.prepare('UPDATE tournaments SET participant_count = participant_count - 1 WHERE id = ? AND participant_count > 0').run(tournamentId);
  }
  return result.changes > 0;
}