/**
 * Phase 4F — transport-agnostic competitive event bus.
 *
 * The competitive services publish typed, invalidation-oriented domain events
 * here AFTER their database transaction has committed. This module deliberately
 * imports nothing from socket.io/Express/HTTP (the `competitive/` boundary in
 * `types.ts`): the transport is wired at the server edge (`index.ts`), which
 * subscribes and rebroadcasts over Socket.IO.
 *
 * Events describe WHAT changed (identifiers), never derived LP/Elo/rank values,
 * so clients treat them as refetch/invalidation signals and the server remains
 * the single source of truth.
 */

export type CompetitiveEventType =
  | 'bracket.updated'
  | 'match.updated'
  | 'match.corrected'
  | 'tournament.updated'
  | 'tournament.completed'
  | 'competitive_profile.updated';

export interface CompetitiveEvent {
  type: CompetitiveEventType;
  /** Server timestamp (ms) at publish time. */
  at: number;
  tournamentId?: string;
  gameId?: string;
  matchId?: string;
  playerId?: string;
  /** Present on `tournament.completed` (null when the final is a draw). */
  championPlayerId?: string | null;
}

export type CompetitiveEventListener = (event: CompetitiveEvent) => void;

const listeners = new Set<CompetitiveEventListener>();

/** Subscribes to domain events. Returns an unsubscribe function. */
export function onCompetitiveEvent(listener: CompetitiveEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Publishes an event to every subscriber. MUST only be called after the
 * originating transaction has committed. Listener failures are isolated so one
 * bad subscriber can never break a committed competitive write.
 */
export function emitCompetitiveEvent(event: Omit<CompetitiveEvent, 'at'> & { at?: number }): void {
  const payload: CompetitiveEvent = { ...event, at: event.at ?? Date.now() };
  for (const listener of [...listeners]) {
    try {
      listener(payload);
    } catch {
      // Never let a subscriber error surface into the commit path.
    }
  }
}
