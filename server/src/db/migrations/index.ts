export { migration0001Init } from './0001_init';
export { migration0002GuestChannel } from './0002_guest_channel';

import { migration0001Init } from './0001_init';
import { migration0002GuestChannel } from './0002_guest_channel';

/**
 * Ordered migration registry. New migrations are appended here in order —
 * never edit an already-shipped migration.
 */
export const migrations: { id: string; sql: string }[] = [
  migration0001Init,
  migration0002GuestChannel,
];
