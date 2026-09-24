import { useState } from 'react';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { usePlayerCompetitive } from '../hooks/usePlayerCompetitive';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { AccountLinkPanel } from '../components/AccountLinkPanel';
import { Link } from '../components/Link';
import { useSeo } from '../seo/useSeo';
import { RankBadge } from '../components/RankBadge';
import { RankProgress } from '../components/RankProgress';
import { ACHIEVEMENTS_CATALOG } from '../data/achievementsCatalog';
import type { PlayerCompetitiveProfile } from '../types/competitive';

/**
 * Phase 12C/12D/12E — the persistent Player Profile page.
 * - #/profile          → own profile (session or guest identity)
 * - #/profile/:playerId→ PUBLIC read-only profile (Phase 13 leaderboard links)
 *
 * Follows the Phase 12 design language: .page-fade > .content-page, glass
 * panels on hub tokens, cyan accent, full RTL Arabic copy.
 */

/**
 * Only http(s) avatar URLs may be used as the hero background (mirrors the
 * PlayerAvatar safety rule). Anything else falls back to the existing theme.
 */
function isSafeAvatarUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const dateFormatter = new Intl.DateTimeFormat('ar', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Phase 2 — one independent competitive ranking card per active game.
 * Every value comes from the server DTO; nothing is computed or hardcoded here.
 */
function GameRankCard({ entry }: { entry: PlayerCompetitiveProfile }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!entry.gameImageUrl && !imgFailed;
  return (
    <article className={`game-rank-card ${entry.unranked ? 'is-unranked' : ''}`}>
      <header className="game-rank-head">
        <span className="game-rank-icon" aria-hidden="true">
          {showImage ? (
            <img
              src={entry.gameImageUrl as string}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setImgFailed(true)}
            />
          ) : (
            '🎮'
          )}
        </span>
        <span className="game-rank-name">{entry.gameNameAr ?? entry.gameSlug ?? entry.gameId}</span>
      </header>

      <div className="game-rank-tier">
        {entry.unranked ? (
          <span className="game-rank-unranked">غير مصنف</span>
        ) : (
          <div className="rank-display rank-display-compact" style={{ '--rank-display-size': '68px' } as React.CSSProperties}>
            <RankBadge tierKey={entry.rank.tierKey} label={entry.rank.rankName} size={68} />
            <span className="rank-display-name">{entry.rank.rankName}</span>
          </div>
        )}
      </div>

      {!entry.unranked && <RankProgress rank={entry.rank} compact />}

      <dl className="game-rank-stats">
        <div>
          <dt>LP</dt>
          <dd>{entry.lp.toLocaleString('ar')}</dd>
        </div>
        <div>
          <dt>Elo</dt>
          <dd>{entry.elo.toLocaleString('ar')}</dd>
        </div>
        <div>
          <dt>ف / خ</dt>
          <dd>
            {entry.wins.toLocaleString('ar')} / {entry.losses.toLocaleString('ar')}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function ProfilePage({ playerId }: { playerId?: string }) {
  // Phase 7 / Step 2 — bumping this re-fetches the OWN profile after a
  // successful account -> Player link, through the existing profile hook.
  const [linkVersion, setLinkVersion] = useState(0);
  const { profile, status } = usePlayerProfile(playerId, true, linkVersion);
  // Server-authoritative per-game competitive rankings for the VIEWED player.
  // Resolved from the profile payload so `/profile` (own) and
  // `/profile/:playerId` (public) share one canonical player id.
  const { profiles: gameRankings, status: rankingsStatus } = usePlayerCompetitive(
    profile?.player.playerId
  );
  const isPublic = !!playerId;
  // Background-image failure is contained here; App re-keys ProfilePage by
  // playerId, so a per-player remount resets this (no cross-player leakage).
  const [heroBgFailed, setHeroBgFailed] = useState(false);

  // SEO — public player metadata only; the signed-in owner's `/profile` is noindex.
  const seoPlayer = profile?.player;
  useSeo(
    isPublic && seoPlayer
      ? {
          title: `${seoPlayer.displayName} | FalFoos`,
          description: `الملف التنافسي للاعب ${seoPlayer.displayName} على منصة فلفوس.`,
          path: `/profile/${encodeURIComponent(playerId ?? '')}`,
          image: isSafeAvatarUrl(seoPlayer.avatarUrl) ? seoPlayer.avatarUrl : undefined,
          type: 'profile',
        }
      : {
          title: 'ملفي الشخصي | FalFoos',
          description: 'ملفك وهوية لاعبك على منصة فلفوس.',
          path: '/profile',
          robots: 'noindex,nofollow',
        }
  );

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
          {/* Phase 7 / Step 2 — an authenticated account with no Player yet is
              exactly the account-linking target; keep the CTA reachable here. */}
          {!isPublic && <AccountLinkPanel onLinked={() => setLinkVersion((v) => v + 1)} />}
          {!isPublic && (
            <Link className="nav-link profile-register-link" to="/register">
              صفحة تسجيل الهوية ←
            </Link>
          )}
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

  const { player, totals, level, achievements, competitive } = profile;
  const earnedIds = new Set(achievements.map((a) => a.id));
  // The hero theme always uses the VIEWED player's image (never the viewer's).
  const heroImage = isSafeAvatarUrl(player.avatarUrl) ? player.avatarUrl : null;

  // Phase 2.z — primary progression UI reads GLOBAL competitive progression,
  // with a defensive fallback to the recreational aliases if unavailable.
  const compLevel = competitive?.level ?? level.level;
  const compTier = competitive?.tier ?? 1;
  const compTierLabel = competitive?.tierLabelAr ?? level.titleAr;
  const compPct = competitive?.progress.pct ?? level.progressPct;

  return (
    <main className="page-fade">
      <div className="content-page">
        {/* ---------- Hero — player identity theme (the viewed player's own image) ---------- */}
        <section
          className={`panel profile-hero comp-tier-${compTier}${competitive?.isMax ? ' comp-max' : ''}${
            heroImage && !heroBgFailed ? ' has-hero-bg' : ''
          }`}
        >
          {heroImage && !heroBgFailed && (
            <img
              className="profile-hero-bg"
              src={heroImage}
              alt=""
              aria-hidden="true"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setHeroBgFailed(true)}
            />
          )}
          <span className="profile-hero-overlay" aria-hidden="true" />
          <PlayerAvatar
            id={player.playerId}
            name={player.displayName}
            avatarUrl={player.avatarUrl ?? undefined}
            size={88}
          />
          <div className="profile-hero-main">
            <div className="profile-hero-kicker">بيانات اللاعب</div>
            <h1 className="profile-name">{player.displayName}</h1>
            <div className="profile-level-row">
              <span className="badge badge-cyan profile-level-chip">
                المستوى {compLevel} · {compTierLabel}
              </span>
              {isPublic && <span className="profile-scope-note">ملف عام للقراءة فقط</span>}
            </div>
            <div className="level-progress" role="progressbar" aria-valuenow={compPct} aria-valuemin={0} aria-valuemax={100}>
              <div className="level-progress-fill" style={{ width: `${compPct}%` }} />
            </div>
            <div className="level-progress-hint">
              {competitive
                ? competitive.isMax
                  ? `أعلى مستوى تنافسي — ${competitive.xp.toLocaleString('ar')} XP`
                  : `${competitive.xp.toLocaleString('ar')} / ${(competitive.progress.next ?? 0).toLocaleString(
                      'ar'
                    )} XP نحو المستوى ${(competitive.level + 1).toLocaleString('ar')}`
                : level.nextLevelAt !== null
                  ? `${totals.totalPoints} / ${level.nextLevelAt} نقطة نحو المستوى ${level.level + 1}`
                  : 'أعلى مستوى — أسطورة حقيقية'}
            </div>
          </div>
        </section>

        {/* ---------- Account <-> Player linking (own profile only) ---------- */}
        {!isPublic && <AccountLinkPanel onLinked={() => setLinkVersion((v) => v + 1)} />}
        {!isPublic && (
          <Link className="nav-link profile-register-link" to="/register">
            صفحة تسجيل الهوية ←
          </Link>
        )}

        {/* ---------- Competitive stat trio (global) ---------- */}
        <section className="profile-stats-row">
          <div className="profile-stat-card">
            <div className="profile-stat-value">{(competitive?.xp ?? totals.totalPoints).toLocaleString('ar')}</div>
            <div className="profile-stat-label">نقاط الخبرة XP</div>
          </div>
          <div className="profile-stat-card">
            <div className="profile-stat-value">{(competitive?.matches ?? totals.matchesPlayed).toLocaleString('ar')}</div>
            <div className="profile-stat-label">مباريات تنافسية</div>
          </div>
          <div className="profile-stat-card profile-stat-wins">
            <div className="profile-stat-value">{(competitive?.wins ?? totals.matchWins).toLocaleString('ar')}</div>
            <div className="profile-stat-label">انتصارات تنافسية</div>
          </div>
        </section>

        {/* ---------- Per-game competitive rankings (Phase 2) ---------- */}
        <h2 className="section-title profile-section-title">🎮 تصنيفات الألعاب</h2>
        {rankingsStatus === 'error' ? (
          <div className="panel profile-empty">تعذّر تحميل التصنيفات — حدّث الصفحة وأعد المحاولة.</div>
        ) : rankingsStatus !== 'ready' ? (
          <div className="panel profile-empty">جارٍ تحميل التصنيفات…</div>
        ) : gameRankings.length === 0 ? (
          <div className="panel profile-empty">لا توجد ألعاب تنافسية متاحة حاليًا.</div>
        ) : (
          <div className="game-ranks-grid">
            {gameRankings.map((entry) => (
              <GameRankCard key={entry.gameId} entry={entry} />
            ))}
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
