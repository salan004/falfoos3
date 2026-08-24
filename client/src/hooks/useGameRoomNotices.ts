import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../utils/socket';

export interface RoomNotice {
  id: number;
  kind: 'joined' | 'rejected';
  at: number;
  displayName?: string;
  message?: string;
  playerCount?: number;
}

const MAX_NOTICES = 3;
const NOTICE_TTL_MS = 7000;

/**
 * Live join feedback for a specific game room, sourced from the unified
 * server events (game:playerJoined / game:joinRejected). Notices auto-expire
 * so the UI never accumulates stale toasts.
 */
export function useGameRoomNotices(gameId: string): RoomNotice[] {
  const [notices, setNotices] = useState<RoomNotice[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const socket = getSocket();
    const timers: ReturnType<typeof setTimeout>[] = [];

    const push = (notice: Omit<RoomNotice, 'id' | 'at'>) => {
      idRef.current += 1;
      const entry: RoomNotice = { ...notice, id: idRef.current, at: Date.now() };
      setNotices((prev) => [...prev.slice(-(MAX_NOTICES - 1)), entry]);
      timers.push(
        setTimeout(() => {
          setNotices((prev) => prev.filter((n) => n.id !== entry.id));
        }, NOTICE_TTL_MS)
      );
    };

    const onJoined = (payload: Record<string, unknown>) => {
      if (!payload || payload.gameId !== gameId) return;
      const name = typeof payload.displayName === 'string' ? payload.displayName : undefined;
      if (!name) return;
      push({
        kind: 'joined',
        displayName: name,
        playerCount: typeof payload.playerCount === 'number' ? payload.playerCount : undefined,
      });
    };

    const onRejected = (payload: Record<string, unknown>) => {
      if (!payload) return;
      // Rejections may carry a gameId (game-specific) or none (no active game).
      if (payload.gameId && payload.gameId !== gameId) return;
      const message = typeof payload.message === 'string' ? payload.message : 'تعذّر الانضمام.';
      push({ kind: 'rejected', message, displayName: typeof payload.displayName === 'string' ? payload.displayName : undefined });
    };

    const onGameEvent = (event: { type: string; payload: Record<string, unknown> }) => {
      if (event?.type === 'game:playerJoined') onJoined(event.payload);
      else if (event?.type === 'game:joinRejected') onRejected(event.payload);
    };

    socket.on('game:event', onGameEvent);

    return () => {
      timers.forEach(clearTimeout);
      // Remove ONLY this listener — never all 'game:event' handlers.
      socket.off('game:event', onGameEvent);
    };
  }, [gameId]);

  return notices;
}
