import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { GameDirectoryEntry } from '../types/game';

/**
 * Phase 4E — «🕹️ العاب البث» entry point.
 *
 * The grid is generated entirely from the competitive game records returned by
 * the public `GET /api/games` endpoint (active games only). No game is
 * hardcoded: an admin creates a game in the dashboard and its card appears here
 * automatically.
 *
 * The grid is ALWAYS rendered. Real games occupy the leading slots and the
 * remaining slots stay as visual placeholders (never database records, never
 * sent to the API). Empty placeholder cards are interactive only for admins.
 */

/** Visual slots kept in the grid so it always reads as a game-selection area. */
const PLACEHOLDER_COUNT = 6;

export function StreamGamesPage() {
  const { navigate } = useHashRoute();
  const { user } = useAuthSession();
  const isAdmin = user?.role === 'admin';
  const headerRef = useScrollReveal<HTMLDivElement>();
  const gridRef = useScrollReveal<HTMLDivElement>();
  const [games, setGames] = useState<GameDirectoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/games');
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError('تعذر تحميل بيانات الألعاب');
        return;
      }
      setGames(Array.isArray(data?.games) ? data.games : []);
    } catch {
      setError('تعذر تحميل بيانات الألعاب');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGames();
  }, [loadGames]);

  const openGame = (id: string) => {
    navigate(`/games/${id}`);
  };

  // Visual placeholders fill the remaining slots; never more than the target
  // grid size, and never negative when there are more real games than slots.
  const placeholderCount = Math.max(0, PLACEHOLDER_COUNT - games.length);

  return (
    <main className="page stream-games-page">
      {/* Hero Section — the supplied trophy artwork is the single, dominant
          visual of the Hero and already carries the «الفلفوسيين المصنفين»
          inscription, so the title stays accessibility-only and is never
          rendered a second time. */}
      <div ref={headerRef} className="reveal stream-games-hero">
        <img
          src="/assets/images/tournaments/stream-games-trophy.png"
          alt="الفلفوسيين المصنفين"
          className="stream-games-trophy-img"
          width={1254}
          height={1254}
          decoding="async"
        />
        <h1 className="sr-only">🏆 الفلفوسيين المصنفين</h1>
      </div>

      {/* Dynamic competitive games grid — always visible. */}
      <div ref={gridRef} className="reveal games-grid stream-games-grid mb-16">
        {loading ? (
          Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
            <div key={`skeleton-${i}`} className="card stream-game-skeleton" aria-hidden="true">
              <div className="stream-game-skeleton-header" />
              <div className="stream-game-skeleton-media" />
            </div>
          ))
        ) : (
          <>
            {error && (
              <div className="stream-games-grid-notice" role="alert">
                <span>{error}</span>
                <button type="button" className="btn-neon text-sm" onClick={loadGames}>
                  إعادة المحاولة
                </button>
              </div>
            )}

            {games.map((g) => (
              <article
                key={g.id}
                className="card stream-game-card text-right"
                style={{ '--card-accent': 'var(--neon-gold)' } as React.CSSProperties}
                onClick={() => openGame(g.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openGame(g.id);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={g.name_ar}
              >
                <header className="stream-game-card-header">
                  <span className="stream-game-card-header-icon" aria-hidden="true">🎮</span>
                  <h3 className="stream-game-card-title">{g.name_ar}</h3>
                </header>

                <div className="stream-game-card-media">
                  {g.image_url ? (
                    <img src={g.image_url} alt={g.name_ar} loading="lazy" decoding="async" />
                  ) : (
                    <div className="stream-game-card-placeholder">
                      <span className="stream-game-card-icon">🎮</span>
                    </div>
                  )}
                  <span className="badge badge-gold stream-game-badge">بطولة</span>
                  {g.description_ar && (
                    <div className="stream-game-card-overlay">
                      <p className="stream-game-card-desc">{g.description_ar}</p>
                    </div>
                  )}
                </div>
              </article>
            ))}

            {Array.from({ length: placeholderCount }, (_, i) =>
              isAdmin ? (
                <button
                  key={`placeholder-${i}`}
                  type="button"
                  className="card stream-game-add-card"
                  onClick={() => navigate('/dashboard/games')}
                  aria-label="إضافة لعبة جديدة"
                >
                  <span className="stream-game-add-plus" aria-hidden="true">+</span>
                  <span className="stream-game-add-label">إضافة لعبة</span>
                </button>
              ) : (
                <div key={`placeholder-${i}`} className="card stream-game-placeholder-card" role="presentation">
                  <span className="stream-game-add-plus" aria-hidden="true">+</span>
                  <span className="stream-game-add-label">متاحة لإضافة لعبة</span>
                </div>
              )
            )}
          </>
        )}
      </div>
    </main>
  );
}
