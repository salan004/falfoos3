/**
 * Phase 4B — CompetitiveProfileService.
 *
 * Owns the materialized `competitive_profiles` row for a `player_id + game_id`
 * pair. Reuses the existing better-sqlite3 singleton (`getDb()`, WAL, FK ON)
 * and the project's transaction pattern. No HTTP, no sockets, no UI.
 *
 * Rank is never stored: callers read LP and derive rank through the Phase 4A
 * pure engine (`computeRank`).
 */

import { getDb } from '../db/db';
import { DEFAULT_INITIAL_ELO } from './eloEngine';
import { computeRank, type ComputedRank } from './ranks';
import { isCompetitiveResult } from './lpEngine';
import type { CompetitiveResult } from './types';

export interface CompetitiveProfileRow {
  player_id: string;
  game_id: string;
  lp: number;
  elo: number;
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  last_played_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface CompetitiveProfileWithRank extends CompetitiveProfileRow {
  rank: ComputedRank;
}

export interface CompetitiveStats {
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`competitive: ${name} must be a non-empty string`);
  }
}

/** True when a guests row exists for this canonical competitive player id. */
export function playerExists(playerId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS ok FROM guests WHERE player_id = ?').get(playerId);
  return !!row;
}

/** True when a games row exists for this game id. */
export function gameExists(gameId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS ok FROM games WHERE id = ?').get(gameId);
  return !!row;
}

/** Reads the profile for (player, game); null when it does not exist yet. */
export function getProfile(playerId: string, gameId: string): CompetitiveProfileRow | null {
  const row = getDb()
    .prepare('SELECT * FROM competitive_profiles WHERE player_id = ? AND game_id = ?')
    .get(playerId, gameId) as CompetitiveProfileRow | undefined;
  return row ?? null;
}

/**
 * Returns the profile, creating it with defaults on first use. The insert is
 * `INSERT OR IGNORE`, so concurrent callers converge on one row (the composite
 * PK is authoritative). Player/game existence is validated for clear errors;
 * the foreign keys remain the ultimate guard.
 */
export function getOrCreateProfile(playerId: string, gameId: string): CompetitiveProfileRow {
  assertNonEmpty(playerId, 'playerId');
  assertNonEmpty(gameId, 'gameId');

  if (!playerExists(playerId)) {
    throw new Error(`competitive: unknown player "${playerId}"`);
  }
  if (!gameExists(gameId)) {
    throw new Error(`competitive: unknown game "${gameId}"`);
  }

  const db = getDb();
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO competitive_profiles
       (player_id, game_id, lp, elo, matches_played, wins, losses, draws, last_played_at, created_at, updated_at)
     VALUES (?, ?, 0, ?, 0, 0, 0, 0, NULL, ?, ?)`
  ).run(playerId, gameId, DEFAULT_INITIAL_ELO, now, now);

  const profile = getProfile(playerId, gameId);
  if (!profile) {
    throw new Error(`competitive: failed to create profile for ${playerId} / ${gameId}`);
  }
  return profile;
}

/** Profile plus its LP-derived rank. Null when the profile does not exist. */
export function getProfileWithRank(
  playerId: string,
  gameId: string
): CompetitiveProfileWithRank | null {
  const profile = getProfile(playerId, gameId);
  if (!profile) return null;
  return { ...profile, rank: computeRank(profile.lp) };
}

/**
 * Increments the match statistics for one completed competitive match.
 *
 * IMPORTANT: This is a service primitive only. Tournament-match orchestration
 * (creating matches, deciding results, winner advancement) belongs to the next
 * phase. A future `CompetitiveService.processMatchResult(...)` should call this
 * together with `LpService.applyLpResult` and `EloService.applyEloResult` inside
 * ONE outer transaction so the whole result is atomic.
 */
export function applyResultStats(
  playerId: string,
  gameId: string,
  result: CompetitiveResult
): CompetitiveProfileRow {
  if (!isCompetitiveResult(result)) {
    throw new Error(`competitive: unsupported result "${String(result)}"`);
  }

  const db = getDb();
  const now = Date.now();
  const column = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';

  const tx = db.transaction((): CompetitiveProfileRow => {
    getOrCreateProfile(playerId, gameId);
    db.prepare(
      `UPDATE competitive_profiles
         SET matches_played = matches_played + 1,
             ${column} = ${column} + 1,
             last_played_at = ?,
             updated_at = ?
       WHERE player_id = ? AND game_id = ?`
    ).run(now, now, playerId, gameId);

    const updated = getProfile(playerId, gameId);
    if (!updated) throw new Error('competitive: profile disappeared during update');
    return updated;
  });

  return tx();
}
