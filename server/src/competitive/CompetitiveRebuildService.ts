/**
 * Phase 4B — CompetitiveRebuildService.
 *
 * Reconstructs a materialized `competitive_profiles` row deterministically from
 * the immutable ledgers `lp_transactions` and `elo_transactions`. This is a
 * controlled, caller-invoked operation: it is NEVER run at startup, never during
 * migration, and never automatically per request. A future admin-only rebuild
 * endpoint can call it.
 *
 * Reconstruction rules:
 * - LP: replay `lp_transactions.amount` in (created_at, id) order starting at 0.
 *   Because stored `amount` is the effective change (floored deficits included),
 *   the chain is consistent.
 * - Elo: replay `elo_transactions.delta` from the engine default (1200).
 * - Stats: count `lp_transactions` rows with `source_type = 'match'` by reason
 *   (`match_win` / `match_loss` / `match_draw`). NOTE: once authoritative
 *   tournament-match records exist, stats should instead be rebuilt from those
 *   records; the LP ledger match rows are the Phase 4B source of truth.
 *
 * The ledgers are read-only here; only the materialized profile is updated, in
 * a single transaction.
 */

import { getDb } from '../db/db';
import { DEFAULT_INITIAL_ELO } from './eloEngine';
import {
  getOrCreateProfile,
  getProfile,
  type CompetitiveProfileRow,
} from './CompetitiveProfileService';

export interface CompetitiveSnapshot {
  lp: number;
  elo: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface RebuildResult {
  playerId: string;
  gameId: string;
  before: CompetitiveSnapshot;
  after: CompetitiveSnapshot;
  changed: boolean;
}

function toSnapshot(profile: CompetitiveProfileRow): CompetitiveSnapshot {
  return {
    lp: profile.lp,
    elo: profile.elo,
    matches_played: profile.matches_played,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
  };
}

function deriveLp(playerId: string, gameId: string): number {
  const rows = getDb()
    .prepare(
      'SELECT amount FROM lp_transactions WHERE player_id = ? AND game_id = ? ORDER BY created_at ASC, id ASC'
    )
    .all(playerId, gameId) as { amount: number }[];
  let lp = 0;
  for (const row of rows) lp += row.amount;
  return Math.max(0, lp);
}

function deriveElo(playerId: string, gameId: string): number {
  const rows = getDb()
    .prepare(
      'SELECT delta FROM elo_transactions WHERE player_id = ? AND game_id = ? ORDER BY created_at ASC, id ASC'
    )
    .all(playerId, gameId) as { delta: number }[];
  let elo = DEFAULT_INITIAL_ELO;
  for (const row of rows) elo += row.delta;
  return elo;
}

interface DerivedStats {
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
}

function deriveStats(playerId: string, gameId: string): DerivedStats {
  const rows = getDb()
    .prepare(
      `SELECT reason AS reason, source_type AS source_type, COUNT(*) AS n
         FROM lp_transactions
        WHERE player_id = ? AND game_id = ?
          AND reason IN ('match_win','match_loss','match_draw')
        GROUP BY reason, source_type`
    )
    .all(playerId, gameId) as { reason: string; source_type: string; n: number }[];

  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const row of rows) {
    // Original match rows and corrected rows add a result; reversal rows
    // (Phase 4F compensation) subtract the result they reverse. Admin/system
    // rows never carry a match_* reason, so they are ignored.
    const sign = row.source_type === 'reversal' ? -1 : 1;
    if (row.reason === 'match_win') wins += sign * row.n;
    else if (row.reason === 'match_loss') losses += sign * row.n;
    else if (row.reason === 'match_draw') draws += sign * row.n;
  }
  wins = Math.max(0, wins);
  losses = Math.max(0, losses);
  draws = Math.max(0, draws);
  return { matches_played: wins + losses + draws, wins, losses, draws };
}

/** Read-only: ledger-derived state without writing to the profile. */
export function deriveProfileState(playerId: string, gameId: string): CompetitiveSnapshot {
  const stats = deriveStats(playerId, gameId);
  return {
    lp: deriveLp(playerId, gameId),
    elo: deriveElo(playerId, gameId),
    ...stats,
  };
}

/** Current materialized snapshot, or null when no profile exists. */
export function snapshotProfile(playerId: string, gameId: string): CompetitiveSnapshot | null {
  const profile = getProfile(playerId, gameId);
  return profile ? toSnapshot(profile) : null;
}

/**
 * Rebuilds one materialized profile from the immutable ledgers. Creates the
 * profile with defaults first when it does not exist. Returns before/after so
 * callers can reconcile.
 */
export function rebuildProfile(playerId: string, gameId: string): RebuildResult {
  const db = getDb();
  const now = Date.now();

  const tx = db.transaction((): RebuildResult => {
    const profile = getOrCreateProfile(playerId, gameId);
    const before = toSnapshot(profile);

    const derived = deriveProfileState(playerId, gameId);

    db.prepare(
      `UPDATE competitive_profiles
          SET lp = ?, elo = ?, matches_played = ?, wins = ?, losses = ?, draws = ?, updated_at = ?
        WHERE player_id = ? AND game_id = ?`
    ).run(
      derived.lp,
      derived.elo,
      derived.matches_played,
      derived.wins,
      derived.losses,
      derived.draws,
      now,
      playerId,
      gameId
    );

    const updated = getProfile(playerId, gameId);
    if (!updated) throw new Error('competitive: profile disappeared during rebuild');
    const after = toSnapshot(updated);

    return {
      playerId,
      gameId,
      before,
      after,
      changed: JSON.stringify(before) !== JSON.stringify(after),
    };
  });

  return tx();
}

/**
 * Rebuilds every profile referenced by the profiles table or either ledger.
 * Intended for a future admin-only operation; never called automatically.
 */
export function rebuildAllProfiles(): RebuildResult[] {
  const rows = getDb()
    .prepare(
      `SELECT player_id AS player_id, game_id AS game_id FROM competitive_profiles
        UNION
       SELECT player_id AS player_id, game_id AS game_id FROM lp_transactions
        UNION
       SELECT player_id AS player_id, game_id AS game_id FROM elo_transactions`
    )
    .all() as { player_id: string; game_id: string }[];

  return rows.map((row) => rebuildProfile(row.player_id, row.game_id));
}
