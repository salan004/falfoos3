import { getDb } from '../db/db';

/**
 * Phase 2.y — explicit game-kind boundary.
 *
 * The website has TWO independent game systems that previously could only be
 * told apart implicitly (in-memory vs DB catalog):
 *
 *   RECREATIONAL stream games — the live BaseGame implementations played during
 *   the broadcast (trivia, mafia, …). Their history lives in `matches`,
 *   `participations`, `score_events`, `match_winners`, `player_achievements`
 *   and is purely recreational: it must NEVER feed competitive progression
 *   (LP/Elo/rank/competitive profile/tournament).
 *
 *   COMPETITIVE games — the database-backed tournament catalog (`games` table),
 *   e.g. Dueling Ground. They feed `competitive_profiles` via tournament results.
 *
 * This module is the SINGLE classification source so callers never have to
 * infer the kind from "in-memory vs database". It adds no schema and performs no
 * writes.
 */

export type GameKind = 'recreational' | 'competitive';

/**
 * Canonical recreational stream-game ids. Kept in sync with the BaseGame
 * implementations registered in `index.ts` (`registerGame`); this constant is
 * the authoritative list for classification.
 */
export const RECREATIONAL_STREAM_GAME_IDS: readonly string[] = Object.freeze([
  'trivia',
  'mafia',
  'musical_chairs',
  'guessing',
  'drawing',
  'hide_and_seek',
]);

const RECREATIONAL = new Set<string>(RECREATIONAL_STREAM_GAME_IDS);

/** True for a recreational stream game id (the in-memory BaseGame set). */
export function isRecreationalStreamGame(gameId: string): boolean {
  return RECREATIONAL.has(gameId);
}

/** True when a competitive catalog row exists for this game id. */
export function isCompetitiveGame(gameId: string): boolean {
  const row = getDb().prepare('SELECT 1 AS ok FROM games WHERE id = ?').get(gameId);
  return !!row;
}

/**
 * Classifies a game id. Returns `'unknown'` for ids that are neither a known
 * stream game nor a competitive catalog entry (e.g. legacy/bot-only ids).
 * A recreational id always wins, so a stream game can never be classified as
 * competitive even if a stray catalog row were created with the same id.
 */
export function classifyGame(gameId: string): GameKind | 'unknown' {
  if (isRecreationalStreamGame(gameId)) return 'recreational';
  if (isCompetitiveGame(gameId)) return 'competitive';
  return 'unknown';
}
