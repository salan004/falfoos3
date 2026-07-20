import { useState, useCallback } from 'react';
import { useWebSocket } from './useWebSocket';
import { GameState, LeaderboardEntry, ChatMessage, GameConfig } from '../types/game';
import { getSocket } from '../utils/socket';

export function useGameState() {
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameList, setGameList] = useState<GameConfig[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [gameEventLog, setGameEventLog] = useState<string[]>([]);

  useWebSocket(
    useCallback((event) => {
      switch (event.type) {
        case 'game:state':
          setGameState(event.payload as GameState);
          break;
        case 'game:switched':
          setActiveGameId(event.payload.gameId as string);
          break;
        case 'leaderboard:update':
          setLeaderboard((event.payload as { entries: LeaderboardEntry[] }).entries);
          break;
        case 'chat:message': {
          const msg = event.payload as { author: string; message: string };
          setChatMessages((prev) => [...prev.slice(-99), { ...msg, timestamp: Date.now() }]);
          break;
        }
        default:
          setGameEventLog((prev) => [...prev.slice(-19), `${event.type}: ${JSON.stringify(event.payload)}`]);
      }
    }, [])
  );

  const loadGames = useCallback(() => {
    const socket = getSocket();
    socket.once('game:list', (data: { games: GameConfig[] }) => {
      setGameList(data.games);
    });
    socket.once('game:active', (data: { gameId: string | null }) => {
      setActiveGameId(data.gameId);
    });
    socket.emit('get:games');
    fetch('/api/games')
      .then((r) => r.json())
      .then((data) => {
        setGameList(data.games);
        setActiveGameId(data.active);
      })
      .catch(() => {});
  }, []);

  return {
    activeGameId,
    gameState,
    gameList,
    leaderboard,
    chatMessages,
    gameEventLog,
    loadGames,
  };
}
