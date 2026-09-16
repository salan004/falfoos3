/**
 * Phase 4A — shared competitive-domain types.
 *
 * Pure data contracts only. This module (and the rest of `competitive/`) must
 * never import Express, better-sqlite3, socket.io, Discord, Streamlabs, React
 * or any browser/HTTP API. Future services consume these types; the engine
 * itself stays deterministic and side-effect free.
 */

/** Official result of a completed competitive tournament match. */
export type CompetitiveResult = 'win' | 'loss' | 'draw';

/** The six competitive tiers, ordered from lowest to highest. */
export type RankTierKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'legendary';

/**
 * Provenance category for a competitive ledger transaction. Phase 4B only
 * writes from `match` (results) and `admin` (adjustments); `tournament`,
 * `correction`, `reversal` and `system` exist for future extensibility and for
 * compensating entries that never mutate historical rows.
 */
export type CompetitiveSourceType =
  | 'match'
  | 'tournament'
  | 'admin'
  | 'correction'
  | 'reversal'
  | 'system';
