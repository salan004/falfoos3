/**
 * Phase 12D — persistent player achievements.
 *
 * The achievement CATALOG is code-defined (achievements/catalog.ts); only
 * earned awards are stored here. Awards are evaluated exclusively inside the
 * GameManager `game:finished` hook — never in the scoring hot path — and the
 * PK makes re-evaluation idempotent.
 */
export const migration0004PlayerAchievements = {
  id: '0004_player_achievements',
  sql: `
CREATE TABLE IF NOT EXISTS player_achievements (
  player_id       TEXT NOT NULL REFERENCES guests(player_id),
  achievement_id  TEXT NOT NULL,
  awarded_at      INTEGER NOT NULL,
  PRIMARY KEY (player_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_player_achievements_player
  ON player_achievements(player_id);
`,
};
