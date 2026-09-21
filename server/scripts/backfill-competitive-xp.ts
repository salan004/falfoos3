/**
 * Phase 2.z — controlled Global Competitive XP backfill.
 *
 * Awards Global Competitive XP for historical COMPLETED tournament matches
 * using the approved rules (loss 25 / draw 35 / win 50). Cancelled/incomplete
 * matches and byes (no match row) are never touched. The operation is
 * idempotent (match/player-scoped idempotency keys), so it is safe to re-run.
 *
 * SAFETY:
 * - Defaults to a DRY RUN (reports scope only).
 * - Requires the explicit `CONFIRM_BACKFILL=yes` environment variable to write.
 * - Uses canonical `guests.player_id` only.
 * - MUST NOT be run against production until Phase 2.x production identity
 *   reconciliation has been completed and the DB/environment is verified.
 *
 * Usage (local):
 *   npx ts-node scripts/backfill-competitive-xp.ts
 *   CONFIRM_BACKFILL=yes npx ts-node scripts/backfill-competitive-xp.ts
 * or:
 *   npm -w server run backfill:xp
 */

import { getDb, initDatabase } from '../src/db/db';
import { backfillCompetitiveXp } from '../src/competitive/GlobalProgressionService';

const info = initDatabase();
const db = getDb();

const completed = (
  db.prepare("SELECT COUNT(*) AS n FROM tournament_matches WHERE status = 'completed'").get() as { n: number }
).n;
const pendingAwards = (
  db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM tournament_match_participants tmp
         JOIN tournament_matches tm ON tm.id = tmp.match_id
         LEFT JOIN competitive_xp_transactions x
           ON x.match_id = tmp.match_id AND x.player_id = tmp.player_id
          AND x.idempotency_key = 'match:' || tmp.match_id || ':' || tmp.player_id || ':xp'
        WHERE tm.status = 'completed' AND x.id IS NULL`
    )
    .get() as { n: number }
).n;
// Already-processed award slots: a completed-match participant whose
// deterministic key already exists in the ledger (idempotency guard).
const alreadyProcessed = (
  db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM tournament_match_participants tmp
         JOIN tournament_matches tm ON tm.id = tmp.match_id
         JOIN competitive_xp_transactions x
           ON x.match_id = tmp.match_id AND x.player_id = tmp.player_id
          AND x.idempotency_key = 'match:' || tmp.match_id || ':' || tmp.player_id || ':xp'
        WHERE tm.status = 'completed'`
    )
    .get() as { n: number }
).n;
// Completed matches that the backfill will SKIP (never 2 participants: byes /
// malformed) — mirrors the service's own guard, reported for transparency.
const invalidIncomplete = (
  db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM tournament_matches tm
        WHERE tm.status = 'completed'
          AND (SELECT COUNT(*) FROM tournament_match_participants p WHERE p.match_id = tm.id) <> 2`
    )
    .get() as { n: number }
).n;

console.log(`[backfill] database: ${info.dbPath}`);
console.log(`[backfill] eligible completed matches: ${completed}`);
console.log(`[backfill] pending XP awards (no ledger row yet): ${pendingAwards}`);
console.log(`[backfill] already processed awards: ${alreadyProcessed}`);
console.log(`[backfill] skipped (completed matches without exactly 2 players): ${invalidIncomplete}`);

if (process.env.CONFIRM_BACKFILL !== 'yes') {
  console.log('[backfill] DRY RUN — set CONFIRM_BACKFILL=yes to execute (idempotent).');
  process.exit(0);
}

const result = backfillCompetitiveXp();
console.log(`[backfill] done: ${JSON.stringify(result)}`);
