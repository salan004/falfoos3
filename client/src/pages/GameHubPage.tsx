import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { TournamentCard } from '../components/TournamentCard';
import { CompetitiveLeaderboard } from '../components/CompetitiveLeaderboard';
import { CompetitivePlayers } from '../components/CompetitivePlayers';
import { CompetitiveRankings } from '../components/CompetitiveRankings';
import { GameDirectoryEntry, TournamentWithGame } from '../types/game';
import type { GameLeaderboardEntry } from '../types/competitive';
import { fetchGameLeaderboard, createTournament } from '../utils/competitiveApi';

interface GameHubPageProps {
  gameId: string;
}

type HubTab = 'tournaments' | 'leaderboard' | 'rankings' | 'players';

const HUB_TABS: { id: HubTab; label: string }[] = [
  { id: 'tournaments', label: '🏆 البطولات' },
  { id: 'leaderboard', label: '🥇 المتصدرين' },
  { id: 'rankings', label: '📊 التصنيف' },
  { id: 'players', label: '👥 اللاعبين' },
];

export function GameHubPage({ gameId }: GameHubPageProps) {
  const { navigate } = useHashRoute();
  const { user } = useAuthSession();
  const isAdmin = user?.role === 'admin';
  const headerRef = useScrollReveal<HTMLDivElement>();

  const [activeTab, setActiveTab] = useState<HubTab>('tournaments');
  const [game, setGame] = useState<GameDirectoryEntry | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [tournaments, setTournaments] = useState<TournamentWithGame[]>([]);
  const [tournamentsLoading, setTournamentsLoading] = useState(true);
  const [tournamentsError, setTournamentsError] = useState<string | null>(null);
  const [players, setPlayers] = useState<GameLeaderboardEntry[]>([]);
  const [competitiveLoading, setCompetitiveLoading] = useState(true);
  const [competitiveError, setCompetitiveError] = useState<string | null>(null);

  const loadTournaments = useCallback(async () => {
    setTournamentsLoading(true);
    setTournamentsError(null);
    try {
      const res = await apiFetch(`/api/games/${gameId}/tournaments`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setTournaments(data.tournaments || []);
    } catch {
      setTournamentsError('فشل تحميل البطولات');
    } finally {
      setTournamentsLoading(false);
    }
  }, [gameId]);

  useEffect(() => {
    let cancelled = false;
    setGameError(null);
    setGame(null);

    apiFetch(`/api/games/${gameId}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.game) {
          setGameError('اللعبة غير موجودة');
          return;
        }
        setGame(data.game);
      })
      .catch(() => {
        if (!cancelled) setGameError('فشل تحميل اللعبة');
      });

    loadTournaments();

    setCompetitiveLoading(true);
    setCompetitiveError(null);
    fetchGameLeaderboard(gameId)
      .then((result) => {
        if (cancelled) return;
        if (!result.ok || !result.data) {
          setCompetitiveError('فشل تحميل بيانات التصنيف');
          return;
        }
        setPlayers(result.data.leaderboard.players);
      })
      .finally(() => {
        if (!cancelled) setCompetitiveLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [gameId, loadTournaments]);

  const openTournament = (id: string) => navigate(`/tournaments/${id}`);

  const gameImage = game?.image_url || null;
  const subtitle = useMemo(() => game?.description_ar || 'المنصة التنافسية للعبة', [game]);

  if (gameError) {
    return (
      <main className="page">
        <div className="panel text-center py-12 text-[var(--text-dim)]">{gameError}</div>
      </main>
    );
  }

  return (
    <main className="page game-hub-page">
      <div ref={headerRef} className="reveal game-hub-header panel">
        <div className="game-hub-header-main">
          <div className="game-hub-artwork">
            {gameImage ? (
              <img src={gameImage} alt={game?.name_ar ?? ''} loading="lazy" decoding="async" />
            ) : (
              <span className="game-hub-artwork-icon" aria-hidden="true">🎮</span>
            )}
          </div>
          <div className="game-hub-titles">
            <div className="brand-kicker">🎮 مركز اللعبة</div>
            <h1 className="game-hub-title">{game?.name_ar ?? 'جارٍ التحميل…'}</h1>
            <p className="game-hub-subtitle">{subtitle}</p>
          </div>
        </div>
        <button className="btn-neon game-hub-back" onClick={() => navigate('/stream-games')}>
          ← كل الألعاب
        </button>
      </div>

      <div className="room-tabs game-hub-tabs" role="tablist" aria-label="أقسام مركز اللعبة">
        {HUB_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`room-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'tournaments' && (
        <section aria-label="بطولات اللعبة">
          <div className="game-hub-section-head">
            <h2 className="section-title">🏆 البطولات</h2>
            {isAdmin && (
              <button className="btn-neon text-sm" onClick={() => navigate('/dashboard/tournaments')}>
                إدارة البطولات
              </button>
            )}
          </div>

          {isAdmin && <CreateTournamentForm gameId={gameId} gameName={game?.name_ar ?? ''} onCreated={loadTournaments} />}

          {tournamentsLoading ? (
            <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">جارٍ تحميل البطولات…</div>
          ) : tournamentsError ? (
            <div className="panel text-center py-12 text-[var(--text-dim)]">{tournamentsError}</div>
          ) : tournaments.length === 0 ? (
            <div className="panel text-center py-12 text-[var(--text-dim)]">لا توجد بطولات لهذه اللعبة حاليًا</div>
          ) : (
            <div className="games-grid">
              {tournaments.map((t) => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  gameImageUrl={t.game_image_url}
                  onClick={() => openTournament(t.id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'leaderboard' && (
        <section aria-label="متصدرو اللعبة">
          <h2 className="section-title" style={{ marginBottom: 16 }}>🥇 المتصدرين</h2>
          <CompetitiveLeaderboard players={players} loading={competitiveLoading} error={competitiveError} />
        </section>
      )}

      {activeTab === 'rankings' && (
        <section aria-label="تصنيف اللعبة">
          <h2 className="section-title" style={{ marginBottom: 16 }}>📊 التصنيف</h2>
          <CompetitiveRankings players={players} loading={competitiveLoading} error={competitiveError} />
        </section>
      )}

      {activeTab === 'players' && (
        <section aria-label="لاعبو اللعبة">
          <h2 className="section-title" style={{ marginBottom: 16 }}>👥 اللاعبين</h2>
          <CompetitivePlayers players={players} loading={competitiveLoading} error={competitiveError} />
        </section>
      )}
    </main>
  );
}

function CreateTournamentForm({
  gameId,
  gameName,
  onCreated,
}: {
  gameId: string;
  gameName: string;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [status, setStatus] = useState<'draft' | 'open'>('open');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setNameAr('');
    setDescriptionAr('');
    setMaxParticipants('');
    setStartsAt('');
    setStatus('open');
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const result = await createTournament({
      game_id: gameId,
      name_ar: nameAr,
      description_ar: descriptionAr || undefined,
      max_participants: maxParticipants ? parseInt(maxParticipants, 10) : undefined,
      starts_at: startsAt ? new Date(startsAt).getTime() : undefined,
      status,
    });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error === 'network_error' ? 'فشل الاتصال بالخادم' : result.error || 'فشل إنشاء البطولة');
      return;
    }
    reset();
    setOpen(false);
    onCreated();
  };

  if (!open) {
    return (
      <button className="btn-neon mb-6" onClick={() => setOpen(true)}>
        + إنشاء بطولة جديدة لهذه اللعبة
      </button>
    );
  }

  return (
    <form className="panel game-hub-create-form mb-6" onSubmit={submit}>
      <h3 className="section-title" style={{ fontSize: '1.05rem', marginBottom: 12 }}>إنشاء بطولة</h3>
      <div className="game-hub-locked-game">
        <span className="text-sm text-[var(--text-dim)]">اللعبة:</span>
        <span className="badge badge-gold">🎮 {gameName || gameId}</span>
      </div>

      {error && <div className="text-[var(--neon-red)] text-sm mb-3">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1">اسم البطولة *</label>
          <input
            className="w-full input-field"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            required
            placeholder="مثال: بطولة الأبطال #1"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1">الوصف</label>
          <textarea
            className="w-full input-field"
            rows={2}
            value={descriptionAr}
            onChange={(e) => setDescriptionAr(e.target.value)}
            placeholder="وصف البطولة…"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">الحد الأقصى للمشاركين</label>
          <input
            type="number"
            min="1"
            className="w-full input-field"
            value={maxParticipants}
            onChange={(e) => setMaxParticipants(e.target.value)}
            placeholder="اتركه فارغًا للا حد"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">الحالة</label>
          <select className="w-full input-field" value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'open')}>
            <option value="open">مفتوحة للتسجيل</option>
            <option value="draft">مسودة</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1">تاريخ البداية (اختياري)</label>
          <input
            type="datetime-local"
            className="w-full input-field"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-4 mt-4 border-t border-[var(--border-color)]">
        <button type="button" className="btn-neon" onClick={() => { setOpen(false); reset(); }}>
          إلغاء
        </button>
        <button type="submit" className="btn-neon" disabled={submitting}>
          {submitting ? 'جاري الإنشاء…' : 'إنشاء البطولة'}
        </button>
      </div>
    </form>
  );
}
