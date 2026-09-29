import { useEffect, useState } from 'react';
import { useRoute } from '../../hooks/useRoute';
import { canCreateTournaments, isSuperAdmin, useAuthSession } from '../../hooks/useAuthSession';
import { useHubTethers, type HubTetherConfig } from '../../hooks/useHubTethers';
import { BrandLogo } from '../BrandLogo';
import { AdminAccessDenied } from './AdminAccessDenied';
import { ModeratorManager } from './ModeratorManager';
import { LockIcon } from './AdminIcons';

/**
 * Admin Control Center.
 *
 * The landing route `/dashboard` is a hub. Two admin tiers share it:
 * - SUPER_ADMIN: every branch (Games, Tournaments) + the moderator manager.
 * - LIMITED_ADMIN: Tournaments (view, and create when permitted) only; Games
 *   is locked. The lock is also enforced server-side (see middleware/authorize).
 *
 * The public HomePage hub is untouched: this reuses the shared hub surfaces
 * plus the additive `.admin-hub-*` / `.admin-*` classes.
 */

type BranchKey = 'games' | 'development' | 'tournaments';

interface HubBranch {
  key: BranchKey;
  icon: string;
  label: string;
  to: string | null;
  /** Always locked (under development). */
  locked: boolean;
  /** Locked only for LIMITED_ADMIN (permission-gated). */
  superOnly?: boolean;
}

const BRANCHES: HubBranch[] = [
  { key: 'games', icon: '🕹️', label: 'الألعاب', to: '/dashboard/games', locked: false, superOnly: true },
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
  title: string;
  sub: string;
}

export function AdminControlCenter() {
  const { navigate } = useRoute();
  const { user, isLoading } = useAuthSession();
  useHubTethers(ADMIN_HUB_CONFIG);

  const [bubble, setBubble] = useState<LockedBubble | null>(null);

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

  const superAdmin = isSuperAdmin(user);
  const mayCreate = canCreateTournaments(user);

  const isLockedForViewer = (branch: HubBranch): boolean =>
    branch.locked || (branch.superOnly === true && !superAdmin);

  const lockMessage = (branch: HubBranch): { title: string; sub: string } => {
    if (branch.superOnly && !superAdmin) {
      return { title: 'مقفل للمشرفين', sub: 'هذا القسم متاح للإدارة الرئيسية فقط' };
    }
    return { title: 'تحت التطوير', sub: 'غير متاحة حاليًا' };
  };

  const handleBranch = (branch: HubBranch, e: React.MouseEvent<HTMLButtonElement>) => {
    if (isLockedForViewer(branch) || !branch.to) {
      const ring = e.currentTarget.querySelector<HTMLElement>('.hub-ring');
      const rect = (ring ?? e.currentTarget).getBoundingClientRect();
      const halfWidth = 120;
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, halfWidth + 8),
        window.innerWidth - halfWidth - 8
      );
      setBubble({ x, y: rect.top - 12, ...lockMessage(branch) });
      return;
    }
    navigate(branch.to);
  };

  return (
    <main className={`hub-shell admin-hub-shell${superAdmin ? ' admin-hub-shell--with-mods' : ''}`}>
      <header className="admin-welcome" dir="rtl">
        <span className="admin-welcome-kicker">{superAdmin ? 'SUPER ADMIN' : 'MODERATOR'}</span>
        <h1 className="admin-welcome-title">أهلًا بك، {user.displayName}</h1>
      </header>

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

        {BRANCHES.map((branch) => {
          const locked = isLockedForViewer(branch);
          const lockNote = branch.superOnly && !superAdmin ? 'مقفل للمشرفين' : null;
          return (
            <button
              key={branch.key}
              type="button"
              className={`hub-orb admin-hub-orb admin-hub-orb-${branch.key}${
                locked ? ' admin-hub-orb--locked' : ''
              }`}
              onClick={(e) => handleBranch(branch, e)}
              aria-disabled={locked || undefined}
              aria-label={locked ? `${branch.label} — ${lockNote ?? 'غير متاحة حاليًا'}` : branch.label}
            >
              <svg className="hub-tether" data-to={branch.key} aria-hidden="true" focusable="false">
                <path className="hub-tether-halo" />
                <path className="hub-tether-line" />
                <path className="hub-tether-pulse" />
              </svg>
              <span className="hub-ring" aria-hidden>
                {locked ? <LockIcon size={26} /> : branch.icon}
              </span>
              <span className="hub-label">{branch.label}</span>
              {lockNote && <span className="admin-hub-lock-note">{lockNote}</span>}
            </button>
          );
        })}
      </div>

      {bubble && (
        <div
          className="hub-dev-bubble hub-dev-bubble--above"
          style={{ left: bubble.x, top: bubble.y }}
          role="status"
          aria-live="polite"
        >
          <span className="hub-dev-bubble-title">{bubble.title}</span>
          <span className="hub-dev-bubble-sub">{bubble.sub}</span>
        </div>
      )}

      {superAdmin && (
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
      )}

      {superAdmin && <ModeratorManager />}
      {!superAdmin && (
        <p className="admin-hub-moderator-note">
          {mayCreate
            ? 'يمكنك مشاهدة البطولات وإنشاء بطولات جديدة. إدارة البطولات متاحة للإدارة الرئيسية فقط.'
            : 'يمكنك مشاهدة البطولات. إنشاء البطولات معطّل حاليًا بواسطة الإدارة الرئيسية.'}
        </p>
      )}
    </main>
  );
}
