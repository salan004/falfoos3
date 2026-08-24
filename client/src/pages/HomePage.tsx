import { useEffect, useRef, useState } from 'react';
import { useHashRoute } from '../hooks/useHashRoute';
import { BrandLogo } from '../components/BrandLogo';
import { useHubTethers } from '../hooks/useHubTethers';

/**
 * Phase 12b — radial FalFoos Hub. The logo is the exact center; four
 * equal-diameter glass circles float around it (top/left/right/bottom) with
 * organic offsets. Pure presentation — no data hooks.
 *
 *   [ الألعاب ]
 * [ المتصدرين ] LOGO [ الروابط ]
 *   [ تحت التطوير ]  ← full-size circle, intentionally quiet (non-clickable)
 *
 * Phase 12F v2 — each orb carries an inline SVG tether (BEFORE the ring, so
 * the glass paints over its inner end) connecting it visually to the logo
 * edge. Activation is pure CSS (:hover / :focus-visible on button.hub-orb);
 * the inert soon orb renders a permanent gray dashed tether with no pulse.
 */

const HUB_POSITIONS = [
  { to: '/games', icon: '🎮', label: 'الألعاب', pos: 'games' },
  { to: '/leaderboard', icon: '🏆', label: 'المتصدرين', pos: 'leaderboard' },
  { to: '/links', icon: '🔗', label: 'الروابط', pos: 'links' },
] as const;

export function HomePage() {
  const { navigate } = useHashRoute();
  useHubTethers();
  const [aboutOpen, setAboutOpen] = useState(false);
  const logoBtnRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Esc-to-close + body scroll lock while the About overlay is open.
  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAboutOpen(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [aboutOpen]);

  const closeAbout = () => {
    setAboutOpen(false);
    logoBtnRef.current?.focus();
  };

  return (
    <main className="hub-shell">
      <div className="hub-stage" role="navigation" aria-label="التنقل الرئيسي">
        {/* Central identity — the logo is the About Me trigger (click/tap
            only; hover is a visual cue, never opens). */}
        <div className="hub-core">
          <span className="hub-about-label" aria-hidden="true">نبذة عني</span>
          <div className="hub-halo" aria-hidden />
          <button
            ref={logoBtnRef}
            className={`hub-logo-btn${aboutOpen ? ' is-dimmed' : ''}`}
            onClick={() => setAboutOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={aboutOpen}
            aria-label="نبذة عني — About FalFoos"
          >
            <BrandLogo size={190} className="hub-logo-img" />
          </button>
        </div>

        {HUB_POSITIONS.map((item) => (
          <button key={item.to} className={`hub-orb hub-orb-${item.pos}`} onClick={() => navigate(item.to)}>
            <svg
              className="hub-tether"
              data-to={item.pos}
              aria-hidden="true"
              focusable="false"
            >
              {/* Cubic Bézier computed by useHubTethers; local axis runs
                  x=len (logo edge) → x=0 (ring anchor) so path direction —
                  and therefore the dash pulse — travels logo → orb.
                  Layers: soft halo bloom beneath the bright core line. */}
              <path className="hub-tether-halo" />
              <path className="hub-tether-line" />
              <path className="hub-tether-pulse" />
            </svg>
            <span className="hub-ring" aria-hidden>
              {item.icon}
            </span>
            <span className="hub-label">{item.label}</span>
          </button>
        ))}

        {/* Quiet future section — full-size circle, deliberately inert */}
        <div className="hub-orb hub-orb-soon" aria-disabled="true">
          <svg className="hub-tether" data-to="soon" aria-hidden="true" focusable="false">
            <path className="hub-tether-line hub-tether-soon" />
          </svg>
          <span className="hub-ring" aria-hidden>
            🛠️
          </span>
          <span className="hub-label">تحت التطوير</span>
        </div>
      </div>

      {/* About Me overlay — covers the whole interface (z-index 80, beneath
          the z-90 route transition). Backdrop click / ✕ / Escape close. */}
      {aboutOpen && (
        <div className="about-backdrop" onClick={closeAbout}>
          <section
            className="about-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              ref={closeBtnRef}
              className="about-close"
              onClick={closeAbout}
              aria-label="إغلاق"
            >
              ✕
            </button>
            <span className="about-kicker">ABOUT ME</span>
            <h2 id="about-title" className="about-title">نبذة عني</h2>
            {/* Owner biography — exact supplied text; only «فلفوس» and
                «فلفوسيين» receive the .about-brand gold treatment. */}
            <p className="about-bio">
              أنا <span className="about-brand">فلفوس</span>، ستريمر وصانع محتوى أحب أحوّل الأفكار والقصص إلى فيديوهات فيها عمق ومعنى وتجربة جميلة لكل شخص يتابعني. 🎮
            </p>
            <p className="about-bio">
              محتواي مو مجرد لعب وبث، أحب دائمًا أقدم أفكار مختلفة وأشياء جديدة تخلي كل بث له طابعه الخاص وتجربته المختلفة عن المعتاد.
            </p>
            <p className="about-bio">
              وطموحي كبير، وفي أشياء كثيرة أحلم أوصل لها وأحققها… لكني مؤمن إن <span className="about-brand">فلفوس</span> ما راح يكون مجرد شخص، <span className="about-brand">فلفوس</span> هو أنا وأنتم.
            </p>
            <p className="about-bio">
              وبدعمكم يا <span className="about-brand">فلفوسيين</span>، بنكبر مع بعض، وبنحقق كل حلم وكل هدف خطوة بخطوة. ❤️🔥
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
