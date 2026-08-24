import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { GAMES_CATALOG } from '../data/gamesCatalog';
import { ACHIEVEMENTS_CATALOG } from '../data/achievementsCatalog';
import type { MatchHistoryItem } from '../types/profile';

/**
 * Phase 12C/12D/12E — the persistent Player Profile page.
 * - #/profile          → own profile (session or guest identity)
 * - #/profile/:playerId→ PUBLIC read-only profile (Phase 13 leaderboard links)
 *
 * Follows the Phase 12 design language: .page-fade > .content-page, glass
 * panels on hub tokens, cyan accent, full RTL Arabic copy.
 */

const GAME_LABELS: Record<string, string> = {
  trivia: 'الأسئلة',
  musical_chairs: 'الكراسي الموسيقية',
  mafia: 'المافيا',
};

function gameLabel(gameId: string): string {
  return (
    GAME_LABELS[gameId] ??
    (GAMES_CATALOG as Record<string, { nameAr?: string }>)[gameId]?.nameAr ??
    gameId
  );
}

function gameMeta(gameId: string): { icon: string; accent?: string } {
  const meta = (GAMES_CATALOG as Record<string, { icon: string; accent?: string }>)[gameId];
  return { icon: meta?.icon ?? '🎮', accent: meta?.accent };
}

const dateFormatter = new Intl.DateTimeFormat('ar', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function HistoryRow({ item }: { item: MatchHistoryItem }) {
  const meta = gameMeta(item.gameId);
  const stillOpen = item.endedAt === null;
  return (
    <div className="history-item">
      <span className="history-game-icon" style={meta.accent ? { borderColor: meta.accent } : undefined}>
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="history-game">{gameLabel(item.gameId)}</div>
        <div className="history-date">
          {dateFormatter.format(new Date(item.startedAt))}
          {stillOpen && <span className="badge badge-cyan history-open-badge">جارية</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {item.wonMatch && <span className="badge badge-cyan win-badge">🏆 فوز</span>}
        {!item.wonMatch && item.wonRound && <span className="badge badge-green win-badge">⭐ جولة</span>}
        <span className="history-points">+{item.pointsEarned}</span>
      </div>
    </div>
  );
}

export function ProfilePage({ playerId }: { playerId?: string }) {
  const { profile, status } = usePlayerProfile(playerId);
  const isPublic = !!playerId;

  if (status === 'loading') {
    return (
      <main className="page-fade">
        <div className="content-page">
          <div className="panel profile-loading-panel">
            <span className="profile-loading-text">جارٍ تحميل الملف الشخصي…</span>
          </div>
        </div>
      </main>
    );
  }

  if (status === 'missing') {
    return (
      <main className="page-fade">
        <div className="content-page">
          <div className="panel text-center" style={{ padding: '40px 20px' }}>
            <h2 className="page-title" style={{ fontSize: '1.4rem' }}>اللاعب غير موجود</h2>
            <p className="hero-subtitle">تحقّق من الرابط أو عُد إلى لوحة المتصدرين.</p>
          </div>
        </div>
      </main>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <main className="page-fade">
        <div className="content-page">
          <div className="panel text-center" style={{ padding: '40px 20px' }}>
            <h2 className="page-title" style={{ fontSize: '1.4rem' }}>
              {status === 'error' ? 'تعذّر تحميل الملف الشخصي' : 'لا توجد هوية لاعب بعد'}
            </h2>
            <p className="hero-subtitle">
              {status === 'error'
                ? 'حدّث الصفحة وأعد المحاولة.'
                : 'افتح أي لعبة وشارك عبر الدردشة، وسيُبنى ملفك تلقائياً.'}
            </p>
          </div>
        </div>
      </main>
    );
  }

  const { player, totals, perGame, recentMatches, historyTotal, level, achievements } = profile;
  const earnedIds = new Set(achievements.map((a) => a.id));

  return (
    <main className="page-fade">
      <div className="content-page">
        {/* ---------- Hero ---------- */}
        <section className="panel profile-hero">
          <PlayerAvatar
            id={player.playerId}
            name={player.displayName}
            avatarUrl={player.avatarUrl ?? undefined}
            size={76}
          />
          <div className="profile-hero-main">
            <h1 className="profile-name">{player.displayName}</h1>
            <div className="profile-level-row">
              <span className="badge badge-cyan profile-level-chip">
                المستوى {level.level} · {level.titleAr}
              </span>
              {isPublic && <span className="profile-scope-note">ملف عام للقراءة فقط</span>}
            </div>
            <div className="level-progress" role="progressbar" aria-valuenow={level.progressPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="level-progress-fill" style={{ width: `${level.progressPct}%` }} />
            </div>
            <div className="level-progress-hint">
              {level.nextLevelAt !== null
                ? `${totals.totalPoints} / ${level.nextLevelAt} نقطة نحو المستوى ${level.level + 1}`
                : 'أعلى مستوى — أسطورة حقيقية'}
            </div>
          </div>
        </section>

        {/* ---------- Stat trio ---------- */}
        <section className="profile-stats-row">
          <div className="profile-stat-card">
            <div className="profile-stat-value">{totals.totalPoints.toLocaleString('ar')}</div>
            <div className="profile-stat-label">إجمالي النقاط</div>
          </div>
          <div className="profile-stat-card">
            <div className="profile-stat-value">{totals.matchesPlayed.toLocaleString('ar')}</div>
            <div className="profile-stat-label">المباريات</div>
          </div>
          <div className="profile-stat-card profile-stat-wins">
            <div className="profile-stat-value">{totals.matchWins.toLocaleString('ar')}</div>
            <div className="profile-stat-label">الانتصارات</div>
          </div>
        </section>

        {/* ---------- Per-game statistics ---------- */}
        <h2 className="section-title profile-section-title">إحصائيات الألعاب</h2>
        {perGame.length === 0 ? (
          <div className="panel profile-empty">لم تلعب أي مباراة بعد — انضم عبر «!انضم» في الدردشة!</div>
        ) : (
          <div className="pergame-grid">
            {perGame.map((stat) => {
              const meta = gameMeta(stat.gameId);
              return (
                <article key={stat.gameId} className="pergame-card" style={meta.accent ? ({ '--pg-accent': meta.accent } as React.CSSProperties) : undefined}>
                  <header className="pergame-header">
                    <span className="pergame-icon">{meta.icon}</span>
                    <span className="pergame-name">{gameLabel(stat.gameId)}</span>
                  </header>
                  <dl className="pergame-stats">
                    <div><dt>نقاط</dt><dd>{stat.totalPoints.toLocaleString('ar')}</dd></div>
                    <div><dt>مباريات</dt><dd>{stat.matchesPlayed.toLocaleString('ar')}</dd></div>
                    <div><dt>انتصارات</dt><dd>{stat.matchWins.toLocaleString('ar')}</dd></div>
                    <div><dt>جولات</dt><dd>{stat.roundWins.toLocaleString('ar')}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}

        {/* ---------- Recent matches ---------- */}
        <h2 className="section-title profile-section-title">سجل المباريات الأخيرة</h2>
        {recentMatches.length === 0 ? (
          <div className="panel profile-empty">لا يوجد سجل بعد — أول مشاركة تظهر هنا.</div>
        ) : (
          <div className="panel" style={{ padding: '6px 14px' }}>
            <div className="history-list">
              {recentMatches.map((item) => (
                <HistoryRow key={item.matchId} item={item} />
              ))}
            </div>
            {historyTotal > recentMatches.length && (
              <div className="history-more">
                تُعرض أحدث {recentMatches.length.toLocaleString('ar')} من {historyTotal.toLocaleString('ar')} مباراة
              </div>
            )}
          </div>
        )}

        {/* ---------- Achievements (Phase 12D) ---------- */}
        <h2 className="section-title profile-section-title">الإنجازات</h2>
        <div className="ach-grid">
          {ACHIEVEMENTS_CATALOG.map((def) => {
            const earned = earnedIds.has(def.id);
            const awarded = achievements.find((a) => a.id === def.id);
            return (
              <div
                key={def.id}
                className={`ach-badge ${earned ? 'earned' : 'locked'}`}
                title={def.descriptionAr}
              >
                <span className="ach-icon" aria-hidden="true">{def.icon}</span>
                <span className="ach-title">{def.titleAr}</span>
                <span className="ach-desc">{def.descriptionAr}</span>
                {earned && awarded && (
                  <span className="ach-date">{dateFormatter.format(new Date(awarded.awardedAt))}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
