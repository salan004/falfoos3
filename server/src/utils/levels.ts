/**
 * Phase 12E — player levels as a PURE derivation of total points.
 *
 * No schema, no persistence: the level is always computed from the same
 * aggregated totals that power the profile. Thresholds are cumulative
 * starting points per level (level N requires THRESHOLDS[N-1] points).
 *
 * Phase 2.y — the input `points` currently come from RECREATIONAL Stream Game
 * scoring (`score_events.points`). This is therefore a RECREATIONAL/LEGACY
 * level: it must NOT be treated as competitive progression and must never feed
 * LP, Elo, rank, competitive profiles or tournament progression. Phase 2.z will
 * introduce the Global Competitive XP/Level system separately and re-source the
 * profile's level from competitive activity — the formula below is unchanged.
 */

export interface LevelInfo {
  /** 1-based level. */
  level: number;
  titleAr: string;
  /** Total points where the current level starts. */
  currentLevelPoints: number;
  /** Total points where the NEXT level starts; null at max level. */
  nextLevelAt: number | null;
  /** 0-100 progress toward the next level; 100 at max level. */
  progressPct: number;
}

const LEVELS: { threshold: number; titleAr: string }[] = [
  { threshold: 0, titleAr: 'مبتدئ' },
  { threshold: 500, titleAr: 'متحدي' },
  { threshold: 1500, titleAr: 'منافس' },
  { threshold: 3000, titleAr: 'محترف' },
  { threshold: 5000, titleAr: 'بطل' },
  { threshold: 8000, titleAr: 'نجم' },
  { threshold: 12000, titleAr: 'أسطورة' },
];

export function computeLevel(totalPoints: number): LevelInfo {
  const points = Math.max(0, Math.floor(totalPoints || 0));
  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    if (points >= LEVELS[i].threshold) index = i;
    else break;
  }
  const current = LEVELS[index];
  const next = LEVELS[index + 1] ?? null;

  if (!next) {
    return {
      level: index + 1,
      titleAr: current.titleAr,
      currentLevelPoints: current.threshold,
      nextLevelAt: null,
      progressPct: 100,
    };
  }

  const span = next.threshold - current.threshold;
  const into = points - current.threshold;
  const progressPct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));

  return {
    level: index + 1,
    titleAr: current.titleAr,
    currentLevelPoints: current.threshold,
    nextLevelAt: next.threshold,
    progressPct,
  };
}
