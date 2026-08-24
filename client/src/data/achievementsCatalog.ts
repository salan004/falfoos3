/**
 * Phase 12D — client mirror of the server's code-defined achievement catalog
 * (server/src/achievements/catalog.ts). Needed to render LOCKED badges; ids
 * must stay in sync with the authoritative server list.
 */
export interface AchievementMeta {
  id: string;
  titleAr: string;
  descriptionAr: string;
  icon: string;
}

export const ACHIEVEMENTS_CATALOG: AchievementMeta[] = [
  { id: 'first_match',     titleAr: 'أول مباراة', descriptionAr: 'شاركت في أول مباراة على FalFoos', icon: '🎮' },
  { id: 'first_win',       titleAr: 'أول فوز',    descriptionAr: 'فزت بأول مباراة كاملة',            icon: '🏆' },
  { id: 'first_round',     titleAr: 'أول جولة',   descriptionAr: 'فزت بأول جولة داخل لعبة',          icon: '⭐' },
  { id: 'ten_matches',     titleAr: '١٠ مباريات', descriptionAr: 'شاركت في عشر مباريات',             icon: '🎯' },
  { id: 'thousand_points', titleAr: '١٠٠٠ نقطة',  descriptionAr: 'جمعت ١٠٠٠ نقطة إجمالية',           icon: '💎' },
];
