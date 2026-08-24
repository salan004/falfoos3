import { getDb } from '../db/db';
import { getPlayerTotals, type PlayerTotals } from '../db/stats';

/**
 * Phase 12D — the initial achievement catalog (locked set of five).
 *
 * The catalog is CODE-DEFINED on purpose: ids are stable identifiers stored
 * in player_achievements; titles/descriptions stay editable without touching
 * rows. Evaluation is EVENT-DRIVEN — it runs only inside GameManager's
 * `game:finished` hook (never in the scoring hot path) and is idempotent via
 * the table's PK.
 */

export interface AchievementDef {
  id: string;
  titleAr: string;
  descriptionAr: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_match',    titleAr: 'أول مباراة',  descriptionAr: 'شاركت في أول مباراة على FalFoos',        icon: '🎮' },
  { id: 'first_win',      titleAr: 'أول فوز',     descriptionAr: 'فزت بأول مباراة كاملة',                  icon: '🏆' },
  { id: 'first_round',    titleAr: 'أول جولة',    descriptionAr: 'فزت بأول جولة داخل لعبة',                icon: '⭐' },
  { id: 'ten_matches',    titleAr: '١٠ مباريات',  descriptionAr: 'شاركت في عشر مباريات',                   icon: '🎯' },
  { id: 'thousand_points',titleAr: '١٠٠٠ نقطة',   descriptionAr: 'جمعت ١٠٠٠ نقطة إجمالية',                 icon: '💎' },
];

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

function isEarned(id: string, totals: PlayerTotals): boolean {
  switch (id) {
    case 'first_match':     return totals.matchesPlayed >= 1;
    case 'first_win':       return totals.matchWins >= 1;
    case 'first_round':     return totals.roundWins >= 1;
    case 'ten_matches':     return totals.matchesPlayed >= 10;
    case 'thousand_points': return totals.totalPoints >= 1000;
    default: return false;
  }
}

/**
 * Awards every newly-earned achievement for this player. Returns the ids
 * inserted NOW (empty when nothing new). Persistence failures are thrown so
 * the caller's try/catch keeps gameplay untouched.
 */
export function evaluateAchievements(playerId: string): string[] {
  const totals = getPlayerTotals(playerId);
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO player_achievements (player_id, achievement_id, awarded_at) VALUES (?, ?, ?)'
  );
  const now = Date.now();
  const newlyAwarded: string[] = [];

  // Single transaction: partial award batches can never land.
  db.transaction(() => {
    for (const def of ACHIEVEMENTS) {
      if (!isEarned(def.id, totals)) continue;
      const result = insert.run(playerId, def.id, now);
      if (result.changes > 0) newlyAwarded.push(def.id);
    }
  })();

  return newlyAwarded;
}

/** Earned achievements with catalog metadata, newest first. */
export function getEarnedAchievements(playerId: string): AwardedAchievementRef[] {
  const rows = getDb()
    .prepare(
      'SELECT achievement_id AS id, awarded_at AS awardedAt FROM player_achievements WHERE player_id = ? ORDER BY awarded_at DESC'
    )
    .all(playerId) as { id: string; awardedAt: number }[];

  return rows
    .map((r) => {
      const def = getAchievement(r.id);
      return def ? { ...def, awardedAt: r.awardedAt } : null;
    })
    .filter((a): a is AwardedAchievementRef => a !== null);
}

export interface AwardedAchievementRef extends AchievementDef {
  awardedAt: number;
}
