import { useEffect, useRef, useCallback } from 'react';
import { getSocket } from '../utils/socket';
import { GameEvent } from '../types/game';

type EventHandler = (event: GameEvent) => void;

export function useWebSocket(handler: EventHandler): void {
  const handlerRef = useRef<EventHandler>(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (event: GameEvent) => {
      handlerRef.current(event);
    };
    socket.on('game:event', listener);
    return () => {
      socket.off('game:event', listener);
    };
  }, []);
}

export function useSocketEvent(eventType: string, handler: (payload: Record<string, unknown>) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const listener = (event: GameEvent) => {
      if (event.type === eventType) {
        handlerRef.current(event.payload);
      }
    };
    socket.on('game:event', listener);
    return () => {
      socket.off('game:event', listener);
    };
  }, [eventType]);
}
