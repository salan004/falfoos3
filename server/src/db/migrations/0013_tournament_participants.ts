/**
 * Phase 3 — Tournament Participants table (additive).
 *
 * Links tournaments to canonical player identities (guests.player_id).
 * Uses YouTube channel identity as the external lookup key.
 */
export const migration0013TournamentParticipants = {
  id: '0013_tournament_participants',
  sql: `
CREATE TABLE IF NOT EXISTS tournament_participants (
  tournament_id   TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id       TEXT NOT NULL REFERENCES guests(player_id) ON DELETE CASCADE,
  source          TEXT NOT NULL DEFAULT 'purchase' CHECK (source IN ('purchase','admin','qualifier')),
  registered_at   INTEGER NOT NULL,
  ticket_ref      TEXT,
  status          TEXT NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','confirmed','cancelled','disqualified')),
  PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_tournament_participants_player ON tournament_participants(player_id);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_ticket ON tournament_participants(ticket_ref);
`,
};