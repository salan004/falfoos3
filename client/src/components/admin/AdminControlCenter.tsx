import { useEffect, useState } from 'react';
import { useHashRoute } from '../../hooks/useHashRoute';
import { useAuthSession } from '../../hooks/useAuthSession';
import { useHubTethers, type HubTetherConfig } from '../../hooks/useHubTethers';
import { BrandLogo } from '../BrandLogo';
import { AdminAccessDenied } from './AdminAccessDenied';

/**
 * Phase F1 — FalFoos Admin Control Center.
 *
 * The landing route `/dashboard` is a hub, not a dashboard: the FalFoos logo is
 * the visual anchor and exactly three independent ICON branches originate from
 * it (each with its own tether): Games, Locked/under-development, Tournaments.
 * No cards, no tiles, no stat panels.
 *
 * The public HomePage hub is untouched: this reuses the shared hub surfaces
 * (`.hub-stage`, `.hub-core`, `.hub-orb`, `.hub-ring`, `.hub-tether`) plus the
 * additive `useHubTethers` configuration, and adds only namespaced
 * `.admin-hub-*` classes for the three-branch geometry.
 */

type BranchKey = 'games' | 'development' | 'tournaments';

interface HubBranch {
  key: BranchKey;
  icon: string;
  label: string;
  to: string | null;
  locked: boolean;
}

const BRANCHES: HubBranch[] = [
  { key: 'games', icon: '🕹️', label: 'الألعاب', to: '/dashboard/games', locked: false },
  { key: 'development', icon: '🔒', label: 'تحت التطوير', to: null, locked: true },
  { key: 'tournaments', icon: '🏆', label: 'البطولات', to: '/dashboard/tournaments', locked: false },
];

const ADMIN_HUB_CONFIG: Partial<HubTetherConfig> = {
  keys: BRANCHES.map((b) => b.key),
  stageSelector: '.admin-hub-stage',
  coreSelector: '.admin-hub-core',
  orbPrefix: 'admin-hub-orb-',
  tetherClass: 'hub-tether',
};

interface LockedBubble {
  x: number;
  y: number;
}

export function AdminControlCenter() {
  const { navigate } = useHashRoute();
  const { user, isLoading } = useAuthSession();
  useHubTethers(ADMIN_HUB_CONFIG);

  const [bubble, setBubble] = useState<LockedBubble | null>(null);

  // Auto-dismiss the locked-section bubble; Escape also closes it.
  useEffect(() => {
    if (!bubble) return;
    const timer = window.setTimeout(() => setBubble(null), 3200);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBubble(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [bubble]);

  if (isLoading) {
    return (
      <main className="admin-hub-shell">
        <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
          جارٍ التحقق من الصلاحية…
        </div>
      </main>
    );
  }

  if (!user || user.role !== 'admin') {
    return <AdminAccessDenied />;
  }

  const handleBranch = (branch: HubBranch, e: React.MouseEvent<HTMLButtonElement>) => {
    if (branch.locked || !branch.to) {
      const ring = e.currentTarget.querySelector<HTMLElement>('.hub-ring');
      const rect = (ring ?? e.currentTarget).getBoundingClientRect();
      const halfWidth = 120;
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, halfWidth + 8),
        window.innerWidth - halfWidth - 8
      );
      setBubble({ x, y: rect.top - 12 });
      return;
    }
    navigate(branch.to);
  };

  return (
    <main className="hub-shell admin-hub-shell">
      <div
        className="hub-stage admin-hub-stage"
        role="navigation"
        aria-label="مركز تحكم FalFoos"
      >
        <div className="hub-core admin-hub-core">
          <div className="hub-halo" aria-hidden />
          <button
            className="hub-logo-btn"
            onClick={() => navigate('/')}
            aria-label="FalFoos — الرئيسية"
            title="العودة إلى الرئيسية"
          >
            <BrandLogo size={190} className="hub-logo-img" />
          </button>
        </div>

        {BRANCHES.map((branch) => (
          <button
            key={branch.key}
            type="button"
            className={`hub-orb admin-hub-orb admin-hub-orb-${branch.key}${
              branch.locked ? ' admin-hub-orb--locked' : ''
            }`}
            onClick={(e) => handleBranch(branch, e)}
            aria-disabled={branch.locked || undefined}
            aria-label={branch.locked ? `${branch.label} — غير متاحة حاليًا` : branch.label}
          >
            <svg className="hub-tether" data-to={branch.key} aria-hidden="true" focusable="false">
              <path className="hub-tether-halo" />
              <path className="hub-tether-line" />
              <path className="hub-tether-pulse" />
            </svg>
            <span className="hub-ring" aria-hidden>
              {branch.icon}
            </span>
            <span className="hub-label">{branch.label}</span>
          </button>
        ))}
      </div>

      {bubble && (
        <div
          className="hub-dev-bubble hub-dev-bubble--above"
          style={{ left: bubble.x, top: bubble.y }}
          role="status"
          aria-live="polite"
        >
          <span className="hub-dev-bubble-title">تحت التطوير</span>
          <span className="hub-dev-bubble-sub">غير متاحة حاليًا</span>
        </div>
      )}

      <nav className="admin-hub-secondary" aria-label="أدوات إدارية إضافية">
        <button className="admin-hub-secondary-link" onClick={() => navigate('/dashboard/live')}>
          📺 لوحة الجلسة المباشرة
        </button>
        <button
          className="admin-hub-secondary-link"
          onClick={() => navigate('/dashboard/trivia-questions')}
        >
          ❓ إدارة أسئلة التريفيا
        </button>
      </nav>
    </main>
  );
}
