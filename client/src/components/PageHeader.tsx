import { useEffect, useState } from 'react';
import { matchGameTournamentsRoute, matchProfileRoute, matchStreamGamesRoute, useHashRoute } from '../hooks/useHashRoute';
import { useAuthSession } from '../hooks/useAuthSession';
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import { apiFetch } from '../utils/api';
import { BrandLogo } from './BrandLogo';
import { ConnectionStatusPill } from './ConnectionStatusPill';
import { AuthWidget } from './AuthWidget';
import { isSoundMuted, setSoundMuted } from '../utils/soundService';

const PAGE_TITLES: Record<string, string> = {
  '/': 'الرئيسية',
  '/games': 'الألعاب',
  '/stream-games': 'ساحة الألعاب والبطولات',
  '/leaderboard': 'المتصدرين',
  '/links': 'الروابط',
  '/connect': 'ربط البث',
  '/register': 'تسجيل الهوية',
  '/dashboard': 'مركز التحكم',
  '/dashboard/live': 'لوحة الجلسة المباشرة',
  '/dashboard/games': 'إدارة الألعاب',
  '/dashboard/tournaments': 'إدارة البطولات',
  '/dashboard/trivia-questions': 'إدارة أسئلة التريفيا',
};

interface PageHeaderProps {
  youtubeStatus: { connected: boolean };
}

/**
 * Phase 12 — minimal centered identity header: [Logo] FalFoos • [Page].
 * Replaces the traditional navigation bar; utility controls live quietly on
 * the side (YouTube connect icon, auth widget, admin-only dashboard icon).
 */
export function PageHeader({ youtubeStatus }: PageHeaderProps) {
  const { path, navigate } = useHashRoute();
  const { user, isLoading } = useAuthSession();
  const isRoleAdmin = user?.role === 'admin';
  // Profile routes (#/profile/:playerId) must title the header with the VIEWED
  // player's name — sourced from the same authoritative profile API the page
  // uses, never from the viewer's session. The hook is gated so non-profile
  // pages never fetch a profile.
  const profileRoute = matchProfileRoute(path);
  const { profile: viewedProfile } = usePlayerProfile(profileRoute?.playerId, profileRoute !== null);
  const profileTitle = profileRoute ? viewedProfile?.player.displayName ?? 'الملف الشخصي' : null;
  // Phase 12F — persisted sound preference (default ON, low volume).
  const [soundOff, setSoundOff] = useState<boolean>(() => isSoundMuted());

  // Game routes (#/games/:gameId and #/stream-games/:gameId) both render the
  // game detail hub. The page label must be the REAL game name read from the
  // catalog API — never the brand wordmark and never a hardcoded string.
  const gameId =
    matchGameTournamentsRoute(path)?.gameId ?? matchStreamGamesRoute(path)?.gameId ?? null;
  const [gameName, setGameName] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setGameName(null);
      return;
    }
    let cancelled = false;
    setGameName(null);
    apiFetch(`/api/games/${gameId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        const nameAr = data?.game?.name_ar;
        if (res.ok && typeof nameAr === 'string' && nameAr.trim().length > 0) {
          setGameName(nameAr.trim());
        }
      })
      .catch(() => {
        /* keeps the neutral fallback below */
      });
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const pathname = path.split('?')[0];
  const pageTitle = gameId
    ? gameName ?? 'مركز اللعبة'
    : PAGE_TITLES[pathname] ??
      (path.startsWith('/game/')
        ? 'غرفة اللعبة'
        : path.startsWith('/tournaments/')
          ? 'البطولة'
          : profileTitle ?? 'FalFoos');

  // Phase 12F FINAL — header YouTube controls exist ONLY on /games; the 📡
  // opens the dedicated connection interface at /connect.
  const showYouTubeHeader = path === '/games';

  return (
    <header className="site-header">
      <button
        className="site-header-title"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onClick={() => navigate('/')}
        title="FalFoos — الرئيسية"
      >
        {/* Phase 12b — the logo image only; this span below is the SINGLE
            brand wordmark, so «FalFoos» can never render twice. */}
        <span className="site-header-logo">
          <BrandLogo size={44} wordmarkFallback={false} />
        </span>
        <span className="site-header-brand">FalFoos</span>
        <span className="site-header-dot">•</span>
        <span className="site-header-page">{pageTitle}</span>
      </button>

      <div className="site-header-utils">
        {showYouTubeHeader && (
          <ConnectionStatusPill status={youtubeStatus} compact />
        )}
        <button
          className="header-icon-btn"
          onClick={() => {
            setSoundMuted(!soundOff);
            setSoundOff(!soundOff);
          }}
          title={soundOff ? 'تشغيل أصوات الواجهة' : 'كتم أصوات الواجهة'}
          aria-label={soundOff ? 'تشغيل الأصوات' : 'كتم الأصوات'}
          aria-pressed={!soundOff}
        >
          {soundOff ? '🔇' : '🔊'}
        </button>
        {showYouTubeHeader && (
          <button
            className={`header-icon-btn ${youtubeStatus.connected ? 'is-live' : ''}`}
            onClick={() => navigate('/connect')}
            aria-label="YouTube Live"
            title="YouTube Live"
          >
            📡
          </button>
        )}
        {!isLoading && isRoleAdmin && (
          <button
            className={`header-icon-btn ${path === '/dashboard' || path.startsWith('/dashboard/') ? 'is-active-page' : ''}`}
            onClick={() => navigate('/dashboard')}
            title="لوحة التحكم"
            aria-label="لوحة التحكم"
          >
            🛠️
          </button>
        )}
        <AuthWidget />
      </div>
    </header>
  );
}
