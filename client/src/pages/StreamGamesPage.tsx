import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
import { GameDirectoryEntry } from '../types/game';

/**
 * Phase 4E — Stream Games / competitive games entry point.
 *
 * The grid is generated entirely from the competitive game records returned by
 * the public `GET /api/games` endpoint (active games only). No game is
 * hardcoded: an admin creates a game in the dashboard and its card appears here
 * automatically.
 *
 * The grid is ALWAYS rendered from real games. Administrators additionally get
 * "Add Game" placeholder tiles that link to the dashboard; those tiles are
 * NEVER rendered for visitors or non-admin users (and are never database
 * records, never sent to the API).
 */

/** Visual slots kept in the grid so it always reads as a game-selection area. */
const PLACEHOLDER_COUNT = 6;

export function StreamGamesPage() {
  const { navigate } = useHashRoute();
  const { user } = useAuthSession();
  const isAdmin = user?.role === 'admin';
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
    navigate(`/stream-games/${id}`);
  };

  // Admin-only "Add Game" tiles fill the remaining grid slots. Non-admins
  // (visitors and authenticated users) never see these placeholders.
  const placeholderCount = Math.max(0, PLACEHOLDER_COUNT - games.length);

  return (
    <main className="page stream-games-page sg-arena">
      {/* Shared Games/Tournaments atmosphere — the single continuous arena
          environment behind the Hero and the game cards. */}
      <ArenaAtmosphere />

      {/* Invisible Hero spacer — vertical breathing room only. It has no
          content, background, border, divider or effect of its own, so the
          arena theme reads as one continuous environment behind the whole page. */}
      <div className="sg-hero" aria-hidden="true" />

      {/* Dynamic competitive games grid — always visible. */}
      <div ref={gridRef} className="reveal games-grid stream-games-grid sg-grid mb-16">
        {loading ? (
          Array.from({ length: PLACEHOLDER_COUNT }, (_, i) => (
            <div key={`skeleton-${i}`} className="card sg-card sg-card-skeleton" aria-hidden="true">
              <div className="sg-card-skeleton-media" />
              <div className="sg-card-skeleton-body">
                <span className="sg-card-skeleton-line" />
                <span className="sg-card-skeleton-line short" />
              </div>
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
                className="card sg-card text-right"
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
                <div className="sg-card-media">
                  {g.image_url ? (
                    <img src={g.image_url} alt={g.name_ar} loading="lazy" decoding="async" />
                  ) : (
                    <div className="sg-card-placeholder">
                      <span className="sg-card-icon">🎮</span>
                    </div>
                  )}
                  <span className="sg-card-badge">🎮 بطولة</span>
                </div>

                <div className="sg-card-body">
                  <h3 className="sg-card-title">{g.name_ar}</h3>
                  {g.description_ar && <p className="sg-card-desc">{g.description_ar}</p>}
                  <span className="sg-card-cta">ادخل الساحة ←</span>
                </div>
              </article>
            ))}

            {isAdmin &&
              Array.from({ length: placeholderCount }, (_, i) => (
                <button
                  key={`placeholder-${i}`}
                  type="button"
                  className="card stream-game-add-card sg-add-card"
                  onClick={() => navigate('/dashboard/games')}
                  aria-label="إضافة لعبة جديدة"
                >
                  <span className="stream-game-add-plus" aria-hidden="true">+</span>
                  <span className="stream-game-add-label">إضافة لعبة</span>
                </button>
              ))}
          </>
        )}
      </div>
    </main>
  );
}
