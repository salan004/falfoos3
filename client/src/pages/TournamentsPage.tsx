import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useRoute } from '../hooks/useRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { TournamentCard } from '../components/TournamentCard';
import { TournamentEntry, TournamentWithGame } from '../types/game';
import { ConnectionStatusPill } from '../components/ConnectionStatusPill';

export function TournamentsPage() {
  const { navigate } = useRoute();
  const headerRef = useScrollReveal<HTMLDivElement>();
  const gridRef = useScrollReveal<HTMLDivElement>();
  const [tournaments, setTournaments] = useState<TournamentWithGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/tournaments')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) {
          setTournaments(data.tournaments || []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('فشل تحميل البطولات');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const openTournament = (id: string) => {
    navigate(`/tournaments/${id}`);
  };

  if (loading) {
    return (
      <main className="page">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ تحميل البطولات…
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <div className="panel text-center py-12 text-[var(--text-dim)]">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div ref={headerRef} className="reveal" style={{ textAlign: 'center', padding: '40px 0 28px' }}>
        <div className="brand-kicker">🏆 الفلفوسيين المصنفين</div>
        <h1 className="hero-title" style={{ fontSize: '2rem' }}>البطولات</h1>
        <p className="hero-subtitle">بطولات مباشرة — سجل الآن وتحدَ غيرك</p>
      </div>

      <div ref={gridRef} className="reveal games-grid mb-16">
        {tournaments.length === 0 ? (
          <div className="panel text-center py-12 text-[var(--text-dim)]">
            لا توجد بطولات متاحة حالياً
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