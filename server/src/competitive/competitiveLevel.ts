/**
 * Phase 2.z — the GLOBAL Competitive Level curve (20 levels).
 *
 * Separate from the recreational `utils/levels.ts` (Stream Game points). Rank
 * is also separate (derived from per-game LP). This module is pure: the level is
 * always derived from cumulative global competitive XP, never stored.
 */

/** Approved competitive XP thresholds, index 0 = Level 1. */
export const COMPETITIVE_LEVEL_THRESHOLDS: readonly number[] = Object.freeze([
  0, // Level 1
  100, // 2
  250, // 3
  450, // 4
  700, // 5
  1000, // 6
  1350, // 7
  1750, // 8
  2200, // 9
  2750, // 10
  3400, // 11
  4150, // 12
  5000, // 13
  6000, // 14
  7200, // 15
  8600, // 16
  10200, // 17
  12000, // 18
  14000, // 19
  16500, // 20
]);

export const COMPETITIVE_MAX_LEVEL = COMPETITIVE_LEVEL_THRESHOLDS.length; // 20

export type CompetitiveTier = 1 | 2 | 3 | 4;

const TIER_LABELS_AR: Record<CompetitiveTier, string> = {
  1: 'صاعد',
  2: 'متحدٍ',
  3: 'نخبة',
  4: 'أسطوري',
};

export interface CompetitiveLevelInfo {
  /** 1..20. */
  level: number;
  /** Visual progression stage: 1 (1–5), 2 (6–10), 3 (11–15), 4 (16–20). */
  tier: CompetitiveTier;
  tierLabelAr: string;
  /** XP where the current level starts. */
  currentLevelXp: number;
  /** XP where the next level starts; null at Level 20. */
  nextLevelXp: number | null;
  /** XP earned inside the current level (>= 0). */
  xpIntoLevel: number;
  /** XP remaining to the next level; null at Level 20. */
  xpForNext: number | null;
  /** 0–100 progress inside the current level; 100 at Level 20. */
  progressPct: number;
  /** True at Level 20 (capped). */
  isMax: boolean;
}

/** Visual tier for a 1..20 level (clamped defensively). */
export function tierForLevel(level: number): CompetitiveTier {
  const l = Math.max(1, Math.min(COMPETITIVE_MAX_LEVEL, Math.floor(level)));
  if (l <= 5) return 1;
  if (l <= 10) return 2;
  if (l <= 15) return 3;
  return 4;
}

function normalizeXp(totalXp: number): number {
  const value = Number(totalXp);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

/**
 * Derives the global competitive level from cumulative XP. Pure and total:
 * any input maps to Level 1..20, with Level 20 capped at 100% progress.
 */
export function computeCompetitiveLevel(totalXp: number): CompetitiveLevelInfo {
  const xp = normalizeXp(totalXp);

  let index = 0;
  for (let i = 0; i < COMPETITIVE_LEVEL_THRESHOLDS.length; i++) {
    if (xp >= COMPETITIVE_LEVEL_THRESHOLDS[i]) index = i;
    else break;
  }

  const current = COMPETITIVE_LEVEL_THRESHOLDS[index];
  const next = index + 1 < COMPETITIVE_LEVEL_THRESHOLDS.length ? COMPETITIVE_LEVEL_THRESHOLDS[index + 1] : null;
  const level = index + 1;
  const tier = tierForLevel(level);

  if (next === null) {
    return {
      level,
      tier,
      tierLabelAr: TIER_LABELS_AR[tier],
      currentLevelXp: current,
      nextLevelXp: null,
      xpIntoLevel: xp - current,
      xpForNext: null,
      progressPct: 100,
      isMax: true,
    };
  }

  const span = next - current;
  const into = xp - current;
  const progressPct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));

  return {
    level,
    tier,
    tierLabelAr: TIER_LABELS_AR[tier],
    currentLevelXp: current,
    nextLevelXp: next,
    xpIntoLevel: into,
    xpForNext: next - xp,
    progressPct,
    isMax: false,
  };
}
