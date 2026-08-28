import { useGameState } from '../hooks/useGameState';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { GameCard } from '../components/GameCard';
import { ConnectionStatusPill } from '../components/ConnectionStatusPill';

/** The game currently in active development gets visual emphasis. */
const FEATURED_GAME_ID = 'mafia';

interface GamesPageProps {
  game: ReturnType<typeof useGameState>;
}

export function GamesPage({ game }: GamesPageProps) {
  const { navigate } = useHashRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();
  const gridRef = useScrollReveal<HTMLDivElement>();

  // Sort: featured first, then the rest in registration order.
  const orderedGames = [
    ...game.gameList.filter((g) => g.id === FEATURED_GAME_ID),
    ...game.gameList.filter((g) => g.id !== FEATURED_GAME_ID),
  ];

  // Phase 9B: opening a Game Room is a passive view/join operation — it must
  // NEVER switch/reset the server-side active game or perform admin actions.
  // Activating/switching games is done by an authorized admin in the Control
  // Panel. Inactive rooms show their own in-room notice.
  const openGame = (id: string) => {
    navigate(`/game/${id}`);
  };

  return (
    <main className="page">
      <div ref={headerRef} className="reveal" style={{ textAlign: 'center', padding: '40px 0 28px' }}>
        <div className="brand-kicker">اختر تجربتك</div>
        <h1 className="hero-title" style={{ fontSize: '2rem' }}>الألعاب</h1>
        <p className="hero-subtitle">ست تجارب مباشرة — التفاعل كله عبر دردشة يوتيوب</p>
      </div>

      {/* Phase A — Broadcast connection entry */}
      <div className="reveal mb-8">
        <div className="panel" style={{ maxWidth: 620, margin: '0 auto' }}>
          <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
            <div className="flex items-center gap-3">
              <span className="game-icon" style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'var(--neon-cyan)', boxShadow: '0 0 18px rgba(0,255,255,0.2)' }}>
                📺
              </span>
              <div>
                <h2 className="room-title" style={{ margin: 0 }}>بث YouTube المباشر</h2>
                <p className="text-sm text-[var(--text-dim)]">اربط بثك لتفعيل أوامر الدردشة في الألعاب</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ConnectionStatusPill status={game.youtubeStatus} compact />
              <button
                className="btn-neon text-sm"
                onClick={() => navigate('/connect')}
              >
                ربط البث
              </button>
            </div>
          </div>
          {!game.youtubeStatus.connected && (
            <p className="text-sm text-[var(--text-dim)] text-center">
              يجب ربط البث قبل بدء الألعاب حتى تعمل أوامر المشاهدين مثل !انضم
            </p>
          )}
        </div>
      </div>

      <div ref={gridRef} className="reveal games-grid mb-16">
        {game.gameList.length === 0 ? (
          <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)] games-grid-loading">
            جارٍ تحميل الألعاب…
          </div>
        ) : (
          orderedGames.map((g) => (
            <GameCard
              key={g.id}
              game={g}
              isActive={game.activeGameId === g.id}
              featured={g.id === FEATURED_GAME_ID}
              gameState={game.gameState}
              playerState={game.gameState as unknown as Record<string, unknown> | null}
              onClick={() => openGame(g.id)}
            />
          ))
        )}
      </div>
    </main>
  );
}
