/**
 * Phase 1C — authoritative Rank → Badge mapping (single source of truth).
 *
 * The backend is authoritative for rank identity: every competitive DTO carries
 * `rank.tierKey` derived from LP via `computeRank`. This module is the ONLY
 * place that maps a tier to a Badge asset, so views never hard-code asset
 * paths and adding a new badge is a one-line change here.
 *
 * Official assets live under `client/public/assets/images/ranks/`.
 * `null`/missing = no asset yet → `RankBadge` renders nothing (never a broken
 * image, never a fabricated placeholder, never a fallback to another tier).
 *
 * Status: the official Bronze asset supplied via Discord CDN
 * (attachments/1271076584362872885/1550161429246513202) was NOT retrievable
 * from this environment (HTTP 404). Per phase rules it is left UNIMPLEMENTED
 * rather than faked. To enable it, drop the official file at
 * `client/public/assets/images/ranks/bronze.png` and uncomment the entry below.
 */
export type RankTierKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'legendary';

const RANK_BADGE_ASSETS: Partial<Record<RankTierKey, string>> = {
  // bronze: '/assets/images/ranks/bronze.png', // official asset pending (CDN 404)
  // silver: '/assets/images/ranks/silver.png',
  // gold: '/assets/images/ranks/gold.png',
  // platinum: '/assets/images/ranks/platinum.png',
  // diamond: '/assets/images/ranks/diamond.png',
  // legendary: '/assets/images/ranks/legendary.png',
};

/**
 * Resolves the Badge asset URL for a rank tier, or null when the tier has no
 * official asset. Unknown/future tiers resolve to null — never to Bronze.
 */
export function rankBadgeAsset(tierKey: string | null | undefined): string | null {
  if (!tierKey) return null;
  return RANK_BADGE_ASSETS[tierKey as RankTierKey] ?? null;
}
