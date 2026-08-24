import { useHashRoute } from '../hooks/useHashRoute';
import { BrandLogo } from '../components/BrandLogo';

/**
 * Phase 12b — radial FalFoos Hub. The logo is the exact center; four
 * equal-diameter glass circles float around it (top/left/right/bottom) with
 * organic offsets. Pure presentation — no data hooks.
 *
 *   [ الألعاب ]
 * [ المتصدرين ] LOGO [ الروابط ]
 *   [ تحت التطوير ]  ← full-size circle, intentionally quiet (non-clickable)
 */

const HUB_POSITIONS = [
  { to: '/games', icon: '🎮', label: 'الألعاب', pos: 'games' },
  { to: '/leaderboard', icon: '🏆', label: 'المتصدرين', pos: 'leaderboard' },
  { to: '/links', icon: '🔗', label: 'الروابط', pos: 'links' },
] as const;

export function HomePage() {
  const { navigate } = useHashRoute();

  return (
    <main className="hub-shell">
      <div className="hub-stage" role="navigation" aria-label="التنقل الرئيسي">
        {/* Central identity */}
        <div className="hub-core">
          <div className="hub-halo" aria-hidden />
          <BrandLogo size={190} className="hub-logo-img" />
        </div>

        {HUB_POSITIONS.map((item) => (
          <button key={item.to} className={`hub-orb hub-orb-${item.pos}`} onClick={() => navigate(item.to)}>
            <span className="hub-ring" aria-hidden>
              {item.icon}
            </span>
            <span className="hub-label">{item.label}</span>
          </button>
        ))}

        {/* Quiet future section — full-size circle, deliberately inert */}
        <div className="hub-orb hub-orb-soon" aria-disabled="true">
          <span className="hub-ring" aria-hidden>
            🛠️
          </span>
          <span className="hub-label">تحت التطوير</span>
        </div>
      </div>
    </main>
  );
}
