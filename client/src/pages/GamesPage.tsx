import { useGameState } from '../hooks/useGameState';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { GameCard } from '../components/GameCard';

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
