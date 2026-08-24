import type BetterSqlite3 from 'better-sqlite3';
import { getDb } from './db';

/**
 * Phase 11G — match/participation/score history persistence.
 *
 * Purely ADDITIVE write-through helpers on top of the existing better-sqlite3
 * singleton (WAL + FK enforcement already configured in Phase 11B):
 * - runtime scoring stays authoritative; SQLite never sits in the hot path
 * - every insert is idempotent where duplicates are possible
 *   (participations PK, matches PK); score_events are intentionally appendable
 * - guest rows are ensured first so FK constraints hold for YouTube players
 *   who may not have a guests row yet (cookie/claim flows are not the only
 *   identity sources)
 */

interface HistoryStatements {
  matchStart: BetterSqlite3.Statement;
  guestEnsure: BetterSqlite3.Statement;
  participation: BetterSqlite3.Statement;
  scoreEvent: BetterSqlite3.Statement;
  completeMatch: BetterSqlite3.Statement;
  incompleteCount: BetterSqlite3.Statement;
}

let statements: HistoryStatements | null = null;

function stmts(): HistoryStatements {
  if (!statements) {
    const db = getDb();
    statements = {
      matchStart: db.prepare('INSERT OR IGNORE INTO matches (id, game_id, started_at) VALUES (?, ?, ?)'),
      guestEnsure: db.prepare(
        'INSERT OR IGNORE INTO guests (player_id, display_name, avatar_url, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)'
      ),
      participation: db.prepare(
        'INSERT OR IGNORE INTO participations (match_id, player_id, status, joined_at) VALUES (?, ?, ?, ?)'
      ),
      scoreEvent: db.prepare(
        'INSERT INTO score_events (match_id, player_id, points, reason, created_at) VALUES (?, ?, ?, NULL, ?)'
      ),
      completeMatch: db.prepare('UPDATE matches SET ended_at = ? WHERE id = ? AND ended_at IS NULL'),
      incompleteCount: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE ended_at IS NULL'),
    };
  }
  return statements;
}

/** Creates the history row for a new game activation (id === sessionId). */
export function recordMatchStart(matchId: string, gameId: string): void {
  stmts().matchStart.run(matchId, gameId, Date.now());
}

/**
 * Guarantees a guests row exists for an external identity (YouTube channel id
 * or verified socket identity) so participations/score_events FKs hold.
 */
export function ensureGuestRow(playerId: string, displayName?: string, avatarUrl?: string): void {
  const now = Date.now();
  stmts()
    .guestEnsure.run(playerId, displayName?.trim() || 'لاعب', avatarUrl ?? null, now, now);
}

/** Idempotent participation record — reconnects/duplicate joins are no-ops. */
export function recordParticipation(matchId: string, playerId: string): void {
  stmts().participation.run(matchId, playerId, 'joined', Date.now());
}

/** Appends one score event. Returns false when no such match exists. */
export function recordScoreEvent(matchId: string, playerId: string, points: number): boolean {
  return stmts().scoreEvent.run(matchId, playerId, points, Date.now()).changes > 0;
}

/** Stamps ended_at once. Incomplete (crashed) matches keep ended_at NULL forever. */
export function completeMatch(matchId: string): boolean {
  return stmts().completeMatch.run(Date.now(), matchId).changes > 0;
}

/** Boot-time visibility into unfinished activations from previous runs. */
export function countIncompleteMatches(): number {
  return (stmts().incompleteCount.get() as { n: number }).n;
}
