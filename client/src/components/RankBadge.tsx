import { rankBadgeAsset } from '../data/rankBadges';

interface RankBadgeProps {
  /** Rank tier key (rank.tierKey) — the authoritative badge identity. */
  tierKey: string | null | undefined;
  /** Accessible label (usually the rank display name). */
  label?: string | null;
  size?: number;
  className?: string;
}

/**
 * Phase 1C — renders the official Rank Badge for a tier. Uses the single
 * `rankBadgeAsset` mapping; renders nothing when no asset exists for the tier
 * (no broken images, no fabricated placeholder, no cross-tier fallback).
 */
export function RankBadge({ tierKey, label, size = 18, className }: RankBadgeProps) {
  const src = rankBadgeAsset(tierKey);
  if (!src) return null;
  return (
    <img
      className={className ? `rank-badge ${className}` : 'rank-badge'}
      src={src}
      alt={label ?? tierKey ?? ''}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  );
}
