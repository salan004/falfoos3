import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import { useHashRoute } from '../hooks/useHashRoute';
import { useScrollReveal } from '../hooks/useScrollReveal';
import { useAuthSession } from '../hooks/useAuthSession';
import { onCompetitiveEvent, getSocket } from '../utils/socket';
import { TournamentCard } from '../components/TournamentCard';
import { ArenaAtmosphere } from '../components/ArenaAtmosphere';
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

  const loadTournaments = useCallback(async (silent = false) => {
    if (!silent) {
      setTournamentsLoading(true);
      setTournamentsError(null);
    }
    try {
      // `/api/games/:id/tournaments` returns bare tournament rows (no
      // participant_count / game metadata). The game-filtered list endpoint
      // returns the enriched `TournamentWithGame` rows the card renders.
      const res = await apiFetch(`/api/tournaments?gameId=${encodeURIComponent(gameId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setTournaments(data.tournaments || []);
    } catch {
      setTournamentsError('فشل تحميل البطولات');
    } finally {
      if (!silent) setTournamentsLoading(false);
    }
  }, [gameId]);

  // Server-authoritative competitive data (LP/Elo/rank/W-L) for the selected
  // game. Shared by the Leaderboard, Rankings and Players tabs — one fetch
  // feeds all three. `silent` skips the loading skeleton for background
  // refreshes triggered by competitive:event.
  const loadCompetitive = useCallback(async (silent = false) => {
    if (!silent) setCompetitiveLoading(true);
    setCompetitiveError(null);
    const result = await fetchGameLeaderboard(gameId);
    if (!result.ok || !result.data) {
      setCompetitiveError('فشل تحميل بيانات التصنيف');
      if (!silent) setCompetitiveLoading(false);
      return;
    }
    setPlayers(result.data.leaderboard.players);
    if (!silent) setCompetitiveLoading(false);
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

    void loadCompetitive();

    return () => {
      cancelled = true;
    };
  }, [gameId, loadTournaments, loadCompetitive]);

  // Phase 1B — real-time invalidation for the Game Hub. The server publishes
  // small `competitive:event` identifiers AFTER a result commits; we treat them
  // as refetch signals only (never mutate LP/Elo/rank/bracket locally). Events
  // for other games are ignored. A burst (a single result emits several events)
  // collapses into one ~250ms-debounced refresh.
  const reloadTimer = useRef<number | null>(null);
  const tournamentsDirty = useRef(false);
  useEffect(() => {
    const scheduleRefresh = () => {
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = null;
        const refreshTournaments = tournamentsDirty.current;
        tournamentsDirty.current = false;
        void loadCompetitive(true);
        if (refreshTournaments) void loadTournaments(true);
      }, 250);
    };

    const off = onCompetitiveEvent((event) => {
      if (event.gameId !== gameId) return;
      // Only tournament/bracket/match events can change the tournament list.
      if (event.tournamentId || event.type === 'tournament.completed') {
        tournamentsDirty.current = true;
      }
      scheduleRefresh();
    });

    // Resync after a Socket.IO reconnect: events emitted while disconnected are
    // not replayed, so refetch once on reconnect (the initial connect is skipped
    // because mount already fetched).
    const socket = getSocket();
    let seenFirstConnect = socket.connected;
    const onConnect = () => {
      if (!seenFirstConnect) {
        seenFirstConnect = true;
        return;
      }
      tournamentsDirty.current = true;
      scheduleRefresh();
    };
    socket.on('connect', onConnect);

    return () => {
      off();
      socket.off('connect', onConnect);
      if (reloadTimer.current !== null) {
        window.clearTimeout(reloadTimer.current);
        reloadTimer.current = null;
      }
      tournamentsDirty.current = false;
    };
  }, [gameId, loadCompetitive, loadTournaments]);

  const openTournament = (id: string) => navigate(`/tournaments/${id}`);

  const gameImage = game?.image_url || null;
  const subtitle = useMemo(() => game?.description_ar || 'المنصة التنافسية للعبة', [game]);

  // Real, derived status only — never invented. Reflects the game's tournaments.
  const activeTournamentEntry = tournaments.find((t) => t.status === 'active');
  const openTournamentEntry = tournaments.find((t) => t.status === 'open');
  const heroStatus = activeTournamentEntry
    ? { label: 'بطولة جارية', className: 'badge-yellow' }
    : openTournamentEntry
      ? { label: 'التسجيل مفتوح', className: 'badge-green' }
      : null;

  if (gameError) {
    return (
      <main className="page">
        <div className="panel text-center py-12 text-[var(--text-dim)]">{gameError}</div>
      </main>
    );
  }

  return (
    <main className="page game-hub-page gh-arena">
      {/* Shared Games/Tournaments atmosphere — same world as the hub, without
          the hub-only character illumination. */}
      <ArenaAtmosphere />

      <section ref={headerRef} className="reveal gh-hero">
        <div className="gh-hero-art">
          {gameImage ? (
            <img src={gameImage} alt={game?.name_ar ?? ''} loading="lazy" decoding="async" />
          ) : (
            <span className="gh-hero-art-icon" aria-hidden="true">🎮</span>
          )}
        </div>

        <div className="gh-hero-body">
          {heroStatus && (
            <div className="gh-hero-status-row">
              <span className={`badge ${heroStatus.className}`}>{heroStatus.label}</span>
            </div>
          )}
          <h1 className="gh-hero-title">{game?.name_ar ?? 'جارٍ التحميل…'}</h1>
          <p className="gh-hero-subtitle">{subtitle}</p>

          <div className="gh-hero-meta">
            {!tournamentsLoading && (
              <span className="gh-chip">🏆 {tournaments.length.toLocaleString('ar')} بطولة</span>
            )}
            {!competitiveLoading && (
              <span className="gh-chip">👥 {players.length.toLocaleString('ar')} لاعب مصنّف</span>
            )}
          </div>

          <div className="gh-hero-actions">
            {isAdmin && (
              <button className="btn-neon" onClick={() => navigate('/dashboard/tournaments')}>
                إدارة البطولات
              </button>
            )}
            <button className="btn-neon gh-hero-back" onClick={() => navigate('/stream-games')}>
              ← كل الألعاب
            </button>
          </div>
        </div>
      </section>

      <div className="room-tabs game-hub-tabs gh-tabs" role="tablist" aria-label="أقسام اللعبة">
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
        <section className="gh-section" aria-label="بطولات اللعبة">
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
            <div className="games-grid gh-tournaments-grid">
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
        <section className="gh-section" aria-label="متصدرو اللعبة">
          <h2 className="section-title" style={{ marginBottom: 16 }}>🥇 المتصدرين</h2>
          <CompetitiveLeaderboard players={players} loading={competitiveLoading} error={competitiveError} />
        </section>
      )}

      {activeTab === 'rankings' && (
        <section className="gh-section" aria-label="تصنيف اللعبة">
          <h2 className="section-title" style={{ marginBottom: 16 }}>📊 التصنيف</h2>
          <CompetitiveRankings players={players} loading={competitiveLoading} error={competitiveError} />
        </section>
      )}

      {activeTab === 'players' && (
        <section className="gh-section" aria-label="لاعبو اللعبة">
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
