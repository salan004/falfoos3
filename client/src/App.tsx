import { useEffect, useState } from 'react';
import { PageHeader } from './components/PageHeader';
import { PageTransition } from './components/PageTransition';
import { Dashboard } from './components/Dashboard';
import { GameRenderer } from './components/GameRenderer';
import { ChatPanel } from './components/ChatPanel';
import { ConnectionStatusPill } from './components/ConnectionStatusPill';
import { YouTubeConnectPanel } from './components/YouTubeConnectPanel';
import { PlayersPanel } from './components/game-room/PlayersPanel';
import { RoomLeaderboard } from './components/game-room/RoomLeaderboard';
import { HomePage } from './pages/HomePage';
import { GamesPage } from './pages/GamesPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LinksPage } from './pages/LinksPage';
import { ProfilePage } from './pages/ProfilePage';
import { GAMES_CATALOG, PHASE_LABELS_AR, resolveGameName } from './data/gamesCatalog';
import { useGameState } from './hooks/useGameState';
import { useHashRoute, matchGameRoute, matchProfileRoute } from './hooks/useHashRoute';
import { useGameSounds } from './hooks/useGameSounds';

// Phase 12F — the /connect route was consolidated into the Games page
// (#/games → «بث يوتيوب المباشر» section). The YouTube connection logic,
// socket protocol and server behavior are unchanged.

function ConnectPage({ game }: { game: ReturnType<typeof useGameState> }) {
  return (
    <main className="page" style={{ maxWidth: 620 }}>
      <div className="text-center" style={{ padding: '36px 0 22px' }}>
        <div className="brand-kicker">اتصال البث</div>
        <h1 className="page-title" style={{ fontSize: '1.7rem' }}>ربط بث YouTube</h1>
        <p className="hero-subtitle">
          اربط بثك المباشر ليصل تفاعل المشاهدين والأوامر إلى الألعاب — الاتصال ليس لعبة، بل بوابة التفاعل.
        </p>
      </div>
      <YouTubeConnectPanel youtubeStatus={game.youtubeStatus} />
      <div className="panel mt-4 text-sm text-[var(--text-dim)] leading-relaxed">
        بعد الربط ستبث رسائل المشاهدين مباشرة إلى الألعاب النشطة، وستظهر في دردشة كل صفحة لعب.
      </div>
    </main>
  );
}

type RoomTab = 'game' | 'players' | 'leaderboard';

const ROOM_TABS: { id: RoomTab; label: string }[] = [
  { id: 'game', label: '🎮 اللعبة' },
  { id: 'players', label: '👥 اللاعبون' },
  { id: 'leaderboard', label: '🏆 المتصدرون' },
];

function GamePage({ gameId, game }: { gameId: string; game: ReturnType<typeof useGameState> }) {
  // Phase 10B: viewer-facing room navigation. Resets to «اللعبة» automatically
  // when the route's gameId changes (GamePage is keyed by gameId in App).
  const [roomTab, setRoomTab] = useState<RoomTab>('game');

  if (!game.gameList.some((g) => g.id === gameId)) {
    return (
      <main className="page">
        <h2 className="page-title">اللعبة غير موجودة</h2>
      </main>
    );
  }

  const isActive = game.activeGameId === gameId;
  const activeConfig = game.gameList.find((g) => g.id === gameId) ?? null;
  const catalogMeta = (GAMES_CATALOG as Record<string, { icon: string; accent: string }>)[gameId];

  return (
    <main
      className={`page room-theme-${gameId}`}
      style={{ width: 'min(1600px, calc(100% - 24px))', marginTop: '16px', '--room-accent': catalogMeta?.accent } as React.CSSProperties}
    >
      <div className="room-header">
        <div className="flex items-center gap-4 min-w-0">
          <span className="game-icon room-icon" style={{ borderColor: isActive ? catalogMeta?.accent : undefined, boxShadow: catalogMeta?.accent ? `0 0 22px ${catalogMeta.accent}30` : undefined }}>
            {catalogMeta?.icon ?? '🎮'}
          </span>
          <div className="min-w-0">
            <h1 className="room-title">{activeConfig ? resolveGameName(activeConfig) : gameId}</h1>
            <div className="room-subtitle">التفاعل عبر أوامر دردشة يوتيوب المباشرة</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isActive && game.gameState && (
            <span className={`badge ${game.gameState.phase === 'playing' ? 'badge-green' : 'badge-cyan'} badge-lg`}>
              {PHASE_LABELS_AR[game.gameState.phase] || game.gameState.phase}
            </span>
          )}
          <ConnectionStatusPill status={game.youtubeStatus} compact />
        </div>
      </div>

      <div className="game-layout">
        <div className="flex flex-col gap-3" style={{ minHeight: 0 }}>
          <div className="room-tabs" role="tablist" aria-label="أقسام غرفة اللعبة">
            {ROOM_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={roomTab === tab.id}
                className={`room-tab ${roomTab === tab.id ? 'active' : ''}`}
                onClick={() => setRoomTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {roomTab === 'game' && (
            <section className="panel game-area flex-1">
              <GameRenderer
                activeGameId={gameId}
                gameState={isActive ? game.gameState : null}
              />
            </section>
          )}

          {/* Phase 10A/10B: view-only panels for players and leaderboard. */}
          {roomTab === 'players' && (
            <PlayersPanel gameId={gameId} gameState={isActive ? game.gameState : null} />
          )}
          {roomTab === 'leaderboard' && (
            <RoomLeaderboard entries={game.leaderboardLoaded ? game.leaderboard : null} />
          )}
        </div>

        <div className="chat-col" style={{ minHeight: 0 }}>
          <ChatPanel messages={game.chatMessages} status={game.youtubeStatus} variant="room" />
        </div>
      </div>
    </main>
  );
}

export default function App() {
  const { path } = useHashRoute();
  const game = useGameState();
  useGameSounds();

  useEffect(() => {
    game.loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gameRoute = matchGameRoute(path);
  const profileRoute = matchProfileRoute(path);

  return (
    <div dir="rtl" style={{ position: 'relative', minHeight: '100vh' }}>
      <PageHeader youtubeStatus={game.youtubeStatus} />
      <PageTransition />
      {path === '/' && <HomePage />}
      {path === '/games' && <GamesPage game={game} />}
      {path === '/leaderboard' && <LeaderboardPage game={game} />}
      {path === '/links' && <LinksPage />}
      {path === '/connect' && <ConnectPage game={game} />}
      {gameRoute && <GamePage key={gameRoute.gameId} gameId={gameRoute.gameId} game={game} />}
      {profileRoute && (
        <ProfilePage
          key={profileRoute.playerId ?? 'me'}
          playerId={profileRoute.playerId}
        />
      )}
      {path === '/dashboard' && <Dashboard game={game} />}
      {!['/', '/games', '/leaderboard', '/links', '/connect', '/dashboard'].includes(path) &&
        !gameRoute &&
        !profileRoute && (
          <main className="page">
            <h2 className="page-title">الصفحة غير موجودة</h2>
          </main>
        )}
    </div>
  );
}
