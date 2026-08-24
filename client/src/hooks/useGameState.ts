import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';
import { GameState, LeaderboardEntry, ChatMessage, GameConfig, YouTubeConnectionStatus } from '../types/game';
import { getSocket } from '../utils/socket';
import { hydrateGameSchemas } from '../config/game-settings-registry';

export function useGameState() {
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameList, setGameList] = useState<GameConfig[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  /** Phase 10B: false until the first real leaderboard payload arrives (REST hydrate or socket event). */
  const [leaderboardLoaded, setLeaderboardLoaded] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [gameEventLog, setGameEventLog] = useState<string[]>([]);
  const [youtubeStatus, setYoutubeStatus] = useState<YouTubeConnectionStatus>({ connected: false });

  // The server emits connection state on its own 'youtube:status' socket event
  // (NOT wrapped in 'game:event'), so it needs a dedicated listener.
  useEffect(() => {
    const socket = getSocket();
    const onYouTubeStatus = (payload: YouTubeConnectionStatus) => {
      setYoutubeStatus({
        connected: payload?.connected === true,
        videoId: payload?.videoId,
        error: payload?.error,
      });
    };
    socket.on('youtube:status', onYouTubeStatus);
    return () => {
      socket.off('youtube:status', onYouTubeStatus);
    };
  }, []);

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
          setLeaderboardLoaded(true);
          break;
        case 'chat:message': {
          const msg = event.payload as { author: string; message: string };
          setChatMessages((prev) => [...prev.slice(-99), { ...msg, timestamp: Date.now() }]);
          break;
        }
        default: {
          if (
            event.type === 'mafia:privateMessage' ||
            event.type === 'mafia:settingsError'
          ) {
            break;
          }
          setGameEventLog((prev) => [...prev.slice(-19), `${event.type}: ${JSON.stringify(event.payload)}`]);
          break;
        }
      }
    }, [])
  );

  const loadGames = useCallback(() => {
    const socket = getSocket();
    socket.once('game:list', (data: { games: GameConfig[] }) => {
      hydrateGameSchemas(data.games);
      setGameList(data.games);
    });
    socket.once('game:active', (data: { gameId: string | null }) => {
      setActiveGameId(data.gameId);
    });
    socket.emit('get:games');
    fetch('/api/games')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.games)) {
          hydrateGameSchemas(data.games);
        }
        setGameList(data.games);
        setActiveGameId(data.active);
      })
      .catch(() => {});
    // Phase 10B: hydrate the leaderboard on load — the server does not push an
    // initial board on connect, so a fresh viewer would see empty scores until
    // the next scoring event. Uses the existing REST endpoint (same pattern as
    // /api/games above); live updates keep flowing via leaderboard:update.
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.entries)) setLeaderboard(data.entries);
      })
      .catch(() => {})
      .finally(() => setLeaderboardLoaded(true));
  }, []);

  return {
    activeGameId,
    gameState,
    gameList,
    leaderboard,
    leaderboardLoaded,
    chatMessages,
    gameEventLog,
    youtubeStatus,
    loadGames,
  };
}
