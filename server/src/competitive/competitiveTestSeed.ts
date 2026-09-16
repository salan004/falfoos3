/**
 * Phase 4B — shared test fixtures for the competitive DB tests.
 *
 * Seeds the minimum `guests` / `games` rows required by the competitive
 * foreign keys, and clears competitive tables between suites. Import only
 * AFTER `./testDb` so the isolated DB path is already active.
 */

import { getDb } from '../db/db';

export function seedPlayer(playerId: string, displayName = 'Test Player'): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO guests (player_id, display_name, avatar_url, first_seen, last_seen)
       VALUES (?, ?, NULL, ?, ?)`
    )
    .run(playerId, displayName, now, now);
}

export function seedGame(gameId: string, slug: string, nameAr = 'لعبة اختبار'): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO games
         (id, slug, name_ar, description_ar, image_url, is_active, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, 1, 0, ?, ?)`
    )
    .run(gameId, slug, nameAr, now, now);
}

export function cleanCompetitive(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM lp_transactions').run();
    db.prepare('DELETE FROM elo_transactions').run();
    db.prepare('DELETE FROM competitive_profiles').run();
  })();
}

export function countRows(table: 'lp_transactions' | 'elo_transactions' | 'competitive_profiles'): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

/* ------------------------------------------------------------------ */
/* Phase 4C — tournament fixtures                                     */
/* ------------------------------------------------------------------ */

export function seedUser(userId: string, role: 'user' | 'admin' = 'admin'): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, display_name, avatar_url, role, created_at)
       VALUES (?, ?, NULL, ?, ?)`
    )
    .run(userId, 'Test Admin', role, now);
}

/** Seeds a user + a live session row and returns the session cookie id. */
export function seedSession(userId: string, role: 'user' | 'admin' = 'admin'): string {
  seedUser(userId, role);
  const sid = `sess-${userId}`;
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO sessions (id, user_id, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`
    )
    .run(sid, userId, now, now + 24 * 60 * 60 * 1000);
  return sid;
}

export function seedTournament(input: {
  id: string;
  gameId: string;
  nameAr?: string;
  status?: 'draft' | 'open' | 'active' | 'completed' | 'cancelled';
  createdBy: string;
  maxParticipants?: number | null;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO tournaments
         (id, game_id, name_ar, description_ar, image_url, status, max_participants,
          starts_at, ends_at, created_by, created_at, updated_at, participant_count)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, NULL, NULL, ?, ?, ?, 0)`
    )
    .run(
      input.id,
      input.gameId,
      input.nameAr ?? 'Test Tournament',
      input.status ?? 'open',
      input.maxParticipants ?? null,
      input.createdBy,
      now,
      now
    );
}

export function seedTournamentParticipant(
  tournamentId: string,
  playerId: string,
  options?: { source?: 'purchase' | 'admin' | 'qualifier'; status?: 'registered' | 'confirmed' | 'cancelled' | 'disqualified' }
): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO tournament_participants
         (tournament_id, player_id, source, registered_at, ticket_ref, status)
       VALUES (?, ?, ?, ?, NULL, ?)`
    )
    .run(tournamentId, playerId, options?.source ?? 'admin', now, options?.status ?? 'registered');
}

/** Deletes tournament bracket + tournament fixtures in FK-safe order. */
export function cleanTournaments(): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_match_participants').run();
    db.prepare('DELETE FROM tournament_matches').run();
    db.prepare('DELETE FROM tournament_participants').run();
    db.prepare('DELETE FROM tournaments').run();
  })();
}
