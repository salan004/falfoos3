/**
 * Phase 4A — the 18-level competitive rank system.
 *
 * Rank is ALWAYS derived from LP and is never stored as mutable state. This
 * mirrors the existing `utils/levels.ts` convention: a pure `compute*` function
 * over a code-defined threshold table. Keeping it pure guarantees a single
 * source of truth (`LP -> Rank`) with no possibility of conflicting cached rank.
 *
 * Structure: 6 tiers x 3 divisions = 18 levels. Each level spans 100 LP.
 *   Bronze 3 (0) ... Legendary 3 (1500), Legendary 2 (1600), Legendary 1 (1700+).
 * Within a tier, division 1 is the highest (e.g. Platinum 1 > Platinum 2 > 3).
 */

import type { RankTierKey } from './types';

/** LP span of every rank level. */
export const LP_PER_LEVEL = 100;
/** Total number of rank levels (6 tiers x 3 divisions). */
export const TOTAL_RANKS = 18;
/** LP at which the top rank (Legendary 1) begins. Unbounded above. */
export const TOP_RANK_THRESHOLD = 1700;

export interface RankDefinition {
  /** Stable identifier, e.g. `gold_1`. Safe for persistence/asset mapping. */
  rankKey: string;
  /** Arabic display name, e.g. `ذهبي 1`. */
  rankName: string;
  /** English display name, e.g. `Gold 1`. */
  rankNameEn: string;
  tierKey: RankTierKey;
  /** 3 (entry division), 2, or 1 (highest division within the tier). */
  division: number;
  /** 1-based overall level, 1 = Bronze 3 ... 18 = Legendary 1. */
  levelIndex: number;
  /** Inclusive LP where this level begins. */
  threshold: number;
  /** Inclusive LP where the next level begins; null for Legendary 1. */
  nextThreshold: number | null;
}

export interface ComputedRank {
  rankKey: string;
  rankName: string;
  rankNameEn: string;
  tierKey: RankTierKey;
  division: number;
  levelIndex: number;
  currentThreshold: number;
  nextThreshold: number | null;
  /** LP earned inside the current level (>= 0). */
  lpIntoLevel: number;
  /** LP remaining to reach the next level; null for Legendary 1. */
  lpForNext: number | null;
  /** 0-100 progress within the current level; 100 at Legendary 1. */
  progressPct: number;
}

const TIERS: { key: RankTierKey; en: string; ar: string }[] = [
  { key: 'bronze', en: 'Bronze', ar: 'برونزي' },
  { key: 'silver', en: 'Silver', ar: 'فضي' },
  { key: 'gold', en: 'Gold', ar: 'ذهبي' },
  { key: 'platinum', en: 'Platinum', ar: 'بلاتيني' },
  { key: 'diamond', en: 'Diamond', ar: 'ماسي' },
  { key: 'legendary', en: 'Legendary', ar: 'أسطوري' },
];

/** Divisions are ordered 3 -> 2 -> 1, so the tier climbs to division 1. */
const DIVISIONS = [3, 2, 1] as const;

function buildRanks(): RankDefinition[] {
  const ranks: RankDefinition[] = [];
  let levelIndex = 0;

  for (const tier of TIERS) {
    for (const division of DIVISIONS) {
      levelIndex += 1;
      const threshold = (levelIndex - 1) * LP_PER_LEVEL;
      ranks.push({
        rankKey: `${tier.key}_${division}`,
        rankName: `${tier.ar} ${division}`,
        rankNameEn: `${tier.en} ${division}`,
        tierKey: tier.key,
        division,
        levelIndex,
        threshold,
        nextThreshold: levelIndex === TOTAL_RANKS ? null : levelIndex * LP_PER_LEVEL,
      });
    }
  }

  return ranks;
}

/** The ordered rank table: index 0 = Bronze 3 ... index 17 = Legendary 1. */
export const RANKS: readonly RankDefinition[] = buildRanks();

/**
 * Coerces arbitrary input into a valid non-negative integer LP value.
 * NaN/Infinity/negative inputs degrade safely to 0, so `computeRank` can never
 * be handed a value that would produce an invalid rank.
 */
export function normalizeLp(lp: number): number {
  const value = Number(lp);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Derives the rank for an LP value. Pure and total: every input maps to one of
 * the 18 defined ranks (clamped at Bronze 3 below, unbounded above).
 */
export function computeRank(lp: number): ComputedRank {
  const value = normalizeLp(lp);

  let definition = RANKS[0];
  for (const candidate of RANKS) {
    if (value >= candidate.threshold) definition = candidate;
    else break;
  }

  const nextThreshold = definition.nextThreshold;
  const lpIntoLevel = value - definition.threshold;
  const lpForNext = nextThreshold === null ? null : nextThreshold - value;
  const progressPct =
    nextThreshold === null
      ? 100
      : Math.max(0, Math.min(100, Math.round((lpIntoLevel / LP_PER_LEVEL) * 100)));

  return {
    rankKey: definition.rankKey,
    rankName: definition.rankName,
    rankNameEn: definition.rankNameEn,
    tierKey: definition.tierKey,
    division: definition.division,
    levelIndex: definition.levelIndex,
    currentThreshold: definition.threshold,
    nextThreshold,
    lpIntoLevel,
    lpForNext,
    progressPct,
  };
}

/** Looks up a rank definition by its stable key; null when unknown. */
export function getRankDefinition(rankKey: string): RankDefinition | null {
  return RANKS.find((rank) => rank.rankKey === rankKey) ?? null;
}
