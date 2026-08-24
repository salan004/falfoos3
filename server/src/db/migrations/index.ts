export { migration0001Init } from './0001_init';
export { migration0002GuestChannel } from './0002_guest_channel';
export { migration0003MatchResults } from './0003_match_results';
export { migration0004PlayerAchievements } from './0004_player_achievements';

import { migration0001Init } from './0001_init';
import { migration0002GuestChannel } from './0002_guest_channel';
import { migration0003MatchResults } from './0003_match_results';
import { migration0004PlayerAchievements } from './0004_player_achievements';

/**
 * Ordered migration registry. New migrations are appended here in order —
 * never edit an already-shipped migration.
 */
export const migrations: { id: string; sql: string }[] = [
  migration0001Init,
  migration0002GuestChannel,
  migration0003MatchResults,
  migration0004PlayerAchievements,
];
