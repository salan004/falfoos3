import type { ComputedRank } from '../types/competitive';

interface RankProgressProps {
  rank: ComputedRank;
  /** Compact spacing for the profile game card. */
  compact?: boolean;
  className?: string;
}

/**
 * Phase 3 — compact presentation of progress toward the next competitive rank.
 *
 * ALL values come from the server `ComputedRank` DTO (`currentThreshold`,
 * `nextThreshold`, `lpIntoLevel`, `lpForNext`, `progressPct`). The frontend
 * never derives thresholds or LP spans, and never divides by 100.
 *
 * The highest rank (Legendary 1) has `nextThreshold === null` and is rendered
 * as a clean "أعلى رتبة" state with the server's `progressPct` (100) — no
 * remaining-LP text and no division.
 */
export function RankProgress({ rank, compact = false, className }: RankProgressProps) {
  const isMax = rank.nextThreshold === null;
  const pct = Math.max(0, Math.min(100, rank.progressPct));
  // Level span is the sum of the two server-provided progress values
  // (LP earned inside the level + LP still needed). No threshold math here.
  const levelSpan = rank.lpIntoLevel + (rank.lpForNext ?? 0);

  return (
    <div className={`rank-progress${compact ? ' rank-progress-compact' : ''}${className ? ` ${className}` : ''}`}>
      <div
        className="rank-progress-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="التقدم نحو الرتبة التالية"
      >
        <span className="rank-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      {isMax ? (
        <div className="rank-progress-hint rank-progress-max">أعلى رتبة</div>
      ) : (
        <div className="rank-progress-hint">
          <span className="rank-progress-lp">
            {rank.lpIntoLevel.toLocaleString('ar')} / {levelSpan.toLocaleString('ar')} LP
          </span>
          <span className="rank-progress-remain">
            متبقي {rank.lpForNext!.toLocaleString('ar')} LP للرتبة التالية
          </span>
        </div>
      )}
    </div>
  );
}
