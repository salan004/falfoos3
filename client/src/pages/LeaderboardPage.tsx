import { useState } from 'react';
import { useGameState } from '../hooks/useGameState';
import { useAuthSession } from '../hooks/useAuthSession';
import { useHashRoute } from '../hooks/useHashRoute';
import { useAllTimeLeaderboard } from '../hooks/useAllTimeLeaderboard';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { LeaderboardEntry } from '../types/game';
import { AllTimeLeaderRow } from '../types/profile';

/**
 * Phase 13 — Advanced Leaderboard page.
 * Tabs: «هذه الجلسة» (live session showcase, unchanged) | «كل الأوقات»
 * (all-time totals over persisted score events, optional per-game filter,
 * 30s polling). Ranking by total points; rows link to public profiles.
 */

/** Visual arrangement mirrors the legacy component exactly: 2nd | 1st | 3rd. */
const PODIUM_LAYOUT = [
  { slot: 1, place: 2, medal: '🥈', cls: 'lb-podium-2', avatarSize: 56 },
  { slot: 0, place: 1, medal: '🥇', cls: 'lb-podium-1', avatarSize: 72 },
  { slot: 2, place: 3, medal: '🥉', cls: 'lb-podium-3', avatarSize: 48 },
] as const;

type LbTab = 'session' | 'alltime';

interface LeaderboardPageProps {
  game: ReturnType<typeof useGameState>;
}

export function LeaderboardPage({ game }: LeaderboardPageProps) {
  const { user } = useAuthSession();
  const { navigate } = useHashRoute();
  const [tab, setTab] = useState<LbTab>('session');
  const [gameFilter, setGameFilter] = useState<string | null>(null);
  const allTime = useAllTimeLeaderboard(tab === 'alltime', gameFilter);

  const entries = game.leaderboard;
  const isLoading = !game.leaderboardLoaded && entries.length === 0;

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  // Self-highlight is supported today via the optional durable userId field
  // the server already includes (declared locally — shared type stays frozen).
  const isMe = (e: LeaderboardEntry) => {
    if (!user) return false;
    const uid = (e as LeaderboardEntry & { userId?: string }).userId;
    return uid != null && uid === user.id;
  };

  const renderRow = (entry: LeaderboardEntry, rank: number) => (
    <div key={entry.playerId} className={`lb-row${isMe(entry) ? ' lb-row-me' : ''}`}>
      <span className="lb-rank">#{rank}</span>
      <PlayerAvatar
        id={entry.playerId}
        name={entry.displayName}
        avatarUrl={entry.avatarUrl}
        size={36}
      />
      <span className="lb-name" title={entry.displayName}>{entry.displayName}</span>
      {isMe(entry) && <span className="lb-me-chip">أنت</span>}
      <span className="lb-leader" aria-hidden="true" />
      <span className="lb-score">{entry.score}</span>
    </div>
  );

  return (
    <main className="page-fade">
      <div className="content-page">
        <section className="lb-shell" aria-label="لوحة المتصدرين">
          <header className="lb-hero">
            <span className="lb-hero-trophy" aria-hidden="true">🏆</span>
            <div className="lb-hero-copy">
              <h1 className="lb-title">المتصدرون</h1>
              <p className="lb-subtitle">
                {tab === 'session'
                  ? 'ترتيب اللاعبين حسب نقاط الجلسة الحالية'
                  : 'أعلى النقاط المتراكمة عبر كل الجلسات المسجلة'}
              </p>
            </div>
            {tab === 'session' && entries.length > 0 && (
              <span className="lb-count">{entries.length} لاعب</span>
            )}
          </header>

          {/* Phase 13 — glass segmented tabs */}
          <div className="lb-tabs" role="tablist" aria-label="نوع لوحة المتصدرين">
            <button
              role="tab"
              aria-selected={tab === 'session'}
              className={`lb-tab${tab === 'session' ? ' is-active' : ''}`}
              onClick={() => setTab('session')}
            >
              هذه الجلسة
            </button>
            <button
              role="tab"
              aria-selected={tab === 'alltime'}
              className={`lb-tab${tab === 'alltime' ? ' is-active' : ''}`}
              onClick={() => setTab('alltime')}
            >
              كل الأوقات
            </button>
          </div>

          {tab === 'alltime' && (
            <div className="lb-games-row" role="group" aria-label="تصفية حسب اللعبة">
              <button
                className={`lb-game-chip${gameFilter === null ? ' is-active' : ''}`}
                onClick={() => setGameFilter(null)}
              >
                الكل
              </button>
              {game.gameList.map((g) => (
                <button
                  key={g.id}
                  className={`lb-game-chip${gameFilter === g.id ? ' is-active' : ''}`}
                  onClick={() => setGameFilter(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}

          {tab === 'session' && (
            <>
              {isLoading ? (
                <div className="lb-skeleton" aria-label="جارٍ التحميل">
                  <span className="lb-skel lb-skel-lg" />
                  <span className="lb-skel" />
                  <span className="lb-skel" />
                </div>
              ) : entries.length === 0 ? (
                <div className="lb-empty">
                  <span className="lb-empty-orb" aria-hidden="true">
                    <span className="lb-empty-icon">🏁</span>
                  </span>
                </div>
              ) : (
                <>
                  {top3.length === 3 && (
                    <div className="lb-podium">
                      {PODIUM_LAYOUT.map(({ slot, place, medal, cls, avatarSize }) => {
                        const entry = top3[slot];
                        if (!entry) return null;
                        return (
                          <article key={place} className={`lb-podium-tile ${cls}`}>
                            <span className="lb-medal" aria-hidden="true">{medal}</span>
                            <PlayerAvatar
                              id={entry.playerId}
                              name={entry.displayName}
                              avatarUrl={entry.avatarUrl}
                              size={avatarSize}
                            />
                            <span className="lb-pname" title={entry.displayName}>
                              {entry.displayName}
                            </span>
                            {isMe(entry) && <span className="lb-me-chip">أنت</span>}
                            <span className="lb-pscore">{entry.score}</span>
                          </article>
                        );
                      })}
                    </div>
                  )}

                  {top3.length === 3 && rest.length > 0 && (
                    <div className="lb-rows">
                      {rest.map((entry, i) => renderRow(entry, i + 4))}
                    </div>
                  )}

                  {/* Fewer than 3 players — flat ranked list from #1 (legacy fallback). */}
                  {top3.length < 3 && top3.length > 0 && (
                    <div className="lb-rows">
                      {entries.map((entry, i) => renderRow(entry, i + 1))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {tab === 'alltime' && <AllTimeView state={allTime} onOpenProfile={(id) => navigate(`/profile/${id}`)} />}
        </section>
      </div>
    </main>
  );
}

interface AllTimeViewProps {
  state: ReturnType<typeof useAllTimeLeaderboard>;
  onOpenProfile: (playerId: string) => void;
}

function AllTimeView({ state, onOpenProfile }: AllTimeViewProps) {
  const { rows, isLoading, hasError } = state;

  if (isLoading && rows.length === 0) {
    return (
      <div className="lb-skeleton" aria-label="جارٍ التحميل">
        <span className="lb-skel lb-skel-lg" />
        <span className="lb-skel" />
        <span className="lb-skel" />
        <span className="lb-skel" />
      </div>
    );
  }

  if (hasError && rows.length === 0) {
    return (
      <div className="lb-at-error">تعذّر تحميل لوحة كل الأوقات — حاول مجددًا لاحقًا.</div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="lb-empty">
        <span className="lb-empty-orb" aria-hidden="true">
          <span className="lb-empty-icon">🏁</span>
        </span>
      </div>
    );
  }

  const rowCls = (rank: number) =>
    rank === 1 ? ' lb-row-gold' : rank === 2 ? ' lb-row-silver' : rank === 3 ? ' lb-row-bronze' : '';

  return (
    <div className="lb-rows lb-alltime" aria-busy={isLoading}>
      {rows.map((row: AllTimeLeaderRow) => (
        <button
          key={row.playerId}
          type="button"
          className={`lb-row lb-row-link${rowCls(row.rank)}`}
          onClick={() => onOpenProfile(row.playerId)}
          title="عرض الملف الشخصي"
        >
          <span className={`lb-rank${row.rank <= 3 ? ' lb-rank-medal' : ''}`}>{row.rank <= 3 ? ['🥇', '🥈', '🥉'][row.rank - 1] : `#${row.rank}`}</span>
          <PlayerAvatar id={row.playerId} name={row.displayName} avatarUrl={row.avatarUrl ?? undefined} size={48} />
          <span className="lb-copy-col">
            <span className="lb-name" title={row.displayName}>{row.displayName}</span>
            <span className="lb-sub-line">
              <span className="lb-level-chip">مستوى {row.level.level} · {row.level.titleAr}</span>
              <span className="lb-wins">🏆 {row.matchWins}</span>
            </span>
          </span>
          <span className="lb-leader" aria-hidden="true" />
          <span className="lb-score">{row.totalPoints}</span>
        </button>
      ))}
    </div>
  );
}
