import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { TournamentCard } from '../components/TournamentCard';
import { GameDirectoryEntry, TournamentWithGame } from '../types/game';
import { resolveGameArtwork } from '../data/gamesCatalog';

interface GameTournamentsPageProps {
  gameId: string;
}

export function GameTournamentsPage({ gameId }: GameTournamentsPageProps) {
  const { navigate } = useHashRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();
  const gridRef = useScrollReveal<HTMLDivElement>();
  const [game, setGame] = useState<GameDirectoryEntry | null>(null);
  const [tournaments, setTournaments] = useState<TournamentWithGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Fetch game info
    apiFetch(`/api/games/${gameId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          if (data.game) {
            setGame(data.game);
          } else {
            setError('اللعبة غير موجودة');
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('فشل تحميل اللعبة');
      });

    // Fetch tournaments for this game
    apiFetch(`/api/games/${gameId}/tournaments`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setTournaments(data.tournaments || []);
        }
      })
      .catch(() => {
        if (!cancelled) setError('فشل تحميل البطولات');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [gameId]);

  const openTournament = (id: string) => {
    navigate(`/tournaments/${id}`);
  };

  const artwork = game ? resolveGameArtwork(game.id) : null;

  if (loading) {
    return (
      <main className="page">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ التحميل…
        </div>
      </main>
    );
  }

  if (error || !game) {
    return (
      <main className="page">
        <div className="panel text-center py-12 text-[var(--text-dim)]">
          {error || 'اللعبة غير موجودة'}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div ref={headerRef} className="reveal" style={{ textAlign: 'center', padding: '40px 0 28px' }}>
        {artwork && (
          <div className="game-page-artwork" style={{ marginBottom: '16px' }}>
            <img src={artwork.src} alt={artwork.alt} loading="lazy" decoding="async" />
          </div>
        )}
        <div className="brand-kicker">🏆 الفلفوسيين المصنفين</div>
        <h1 className="hero-title" style={{ fontSize: '2rem' }}>{game.name_ar}</h1>
        {game.description_ar && <p className="hero-subtitle">{game.description_ar}</p>}
      </div>

      <div ref={gridRef} className="reveal games-grid mb-16">
        {tournaments.length === 0 ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">
            لا توجد بطولات لهذه اللعبة حالياً
          </div>
        ) : (
          tournaments.map((t) => (
            <TournamentCard
              key={t.id}
              tournament={t}
              gameImageUrl={t.game_image_url}
              onClick={() => openTournament(t.id)}
            />
          ))
        )}
      </div>
    </main>
  );
}