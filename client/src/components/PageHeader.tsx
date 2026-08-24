import { useState } from 'react';
import { useHashRoute } from '../hooks/useHashRoute';
import { useAuthSession } from '../hooks/useAuthSession';
import { BrandLogo } from './BrandLogo';
import { ConnectionStatusPill } from './ConnectionStatusPill';
import { AuthWidget } from './AuthWidget';
import { isSoundMuted, setSoundMuted } from '../utils/soundService';

const PAGE_TITLES: Record<string, string> = {
  '/': 'الرئيسية',
  '/games': 'الألعاب',
  '/leaderboard': 'المتصدرين',
  '/links': 'الروابط',
  '/connect': 'ربط البث',
  '/dashboard': 'لوحة التحكم',
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
  // Phase 12F — persisted sound preference (default ON, low volume).
  const [soundOff, setSoundOff] = useState<boolean>(() => isSoundMuted());

  const pageTitle =
    PAGE_TITLES[path] ?? (path.startsWith('/game/') ? 'غرفة اللعبة' : 'FalFoos');

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
            className={`header-icon-btn ${path === '/dashboard' ? 'is-active-page' : ''}`}
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
