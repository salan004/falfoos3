/**
 * Phase 11D — guest ↔ YouTube channel binding.
 * Lets a guest row carry the channelId proven via a live-chat challenge
 * (unique: one channel maps to at most one guest), which also retroactively
 * tags legacy rows that were keyed BY their channelId.
 */
export const migration0002GuestChannel = {
  id: '0002_guest_channel',
  sql: `
ALTER TABLE guests ADD COLUMN youtube_channel_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_yt_channel
  ON guests(youtube_channel_id)
  WHERE youtube_channel_id IS NOT NULL;
`,
};
