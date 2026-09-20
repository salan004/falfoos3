import { useEffect, useState } from 'react';
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
 * Phase 1C / Phase 3 — renders the official Rank Badge for a tier. Uses the
 * single `rankBadgeAsset` mapping; renders nothing when no asset exists for the
 * tier (no broken images, no fabricated placeholder, no cross-tier fallback).
 *
 * Phase 3 — a broken/failed asset is also treated as "no badge": the image is
 * dropped after a load error so a broken `<img>` icon can never remain visible.
 */
export function RankBadge({ tierKey, label, size = 18, className }: RankBadgeProps) {
  const src = rankBadgeAsset(tierKey);
  const [failed, setFailed] = useState(false);

  // Re-arm when the resolved asset changes (e.g. switching games/ranks).
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;
  return (
    <img
      className={className ? `rank-badge ${className}` : 'rank-badge'}
      src={src}
      alt={label ?? tierKey ?? ''}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
