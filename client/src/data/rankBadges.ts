/**
 * Phase 1C / Phase 3 — authoritative Rank → Badge mapping (single source of truth).
 *
 * The backend is authoritative for rank identity: every competitive DTO carries
 * `rank.tierKey` derived from LP via `computeRank`. This module is the ONLY
 * place that maps a tier to a Badge asset, so views never hard-code asset
 * paths.
 *
 * Phase 3 — asset detection is automatic. Official assets live under
 * `client/public/assets/images/ranks/` named by TIER (`bronze.png`,
 * `silver.png`, …). A tier resolves ONLY when its file actually exists in that
 * directory (resolved at build time via `import.meta.glob`); tiers without a
 * file resolve to `null`, so `RankBadge` renders nothing — never a broken
 * image, never a fabricated placeholder, never a fallback to another tier.
 *
 * To enable a badge: drop the official file at
 * `client/public/assets/images/ranks/<tier>.png`. No code change is required.
 *
 * Badges are TIER-level by contract: Bronze 3/2/1 all share `bronze.png`.
 */

export type RankTierKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'legendary';

/** Canonical tier → asset file name. Divisions intentionally share one badge. */
const TIER_ASSET_FILE: Record<RankTierKey, string> = {
  bronze: 'bronze.png',
  silver: 'silver.png',
  gold: 'gold.png',
  platinum: 'platinum.png',
  diamond: 'diamond.png',
  legendary: 'legendary.png',
};

/**
 * Every `*.png` present in the rank asset directory, resolved to a served URL.
 * Empty when the directory does not exist or holds no files yet.
 */
const RANK_ASSET_URLS = import.meta.glob('../../public/assets/images/ranks/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function assetUrlForFile(fileName: string): string | null {
  for (const [modulePath, url] of Object.entries(RANK_ASSET_URLS)) {
    if (modulePath.endsWith(`/${fileName}`)) return url;
  }
  return null;
}

/**
 * Resolves the Badge asset URL for a rank tier, or null when the tier has no
 * official asset (or is unknown/future). Never falls back to another tier.
 */
export function rankBadgeAsset(tierKey: string | null | undefined): string | null {
  if (!tierKey) return null;
  const file = TIER_ASSET_FILE[tierKey as RankTierKey];
  if (!file) return null;
  return assetUrlForFile(file);
}
