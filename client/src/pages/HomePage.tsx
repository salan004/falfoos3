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
 *   [ العاب البث ]  ← same slot as the former «تحت التطوير» circle
 *
 * Phase 12F v2 — each orb carries an inline SVG tether (BEFORE the ring, so
 * the glass paints over its inner end) connecting it visually to the logo
 * edge. Activation is pure CSS (:hover / :focus-visible on button.hub-orb);
 * the bottom orb keeps the original «تحت التطوير» slot geometry but is now a
 * live navigation entry to the Stream Games section.
 */

const HUB_POSITIONS = [
  { to: '/games', icon: '🎮', label: 'الألعاب', pos: 'games', locked: true },
  { to: '/stream-games', icon: '🕹️', label: 'ساحة الألعاب والبطولات', pos: 'stream-games', locked: false },
  { to: '/leaderboard', icon: '🏆', label: 'المتصدرين', pos: 'leaderboard', locked: true },
  { to: '/links', icon: '🔗', label: 'الروابط', pos: 'links', locked: false },
] as const;

type DevBubble = { x: number; y: number; variant: 'below' | 'above' };

export function HomePage() {
  const { navigate } = useHashRoute();
  useHubTethers();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [devBubble, setDevBubble] = useState<DevBubble | null>(null);
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

  // Development bubble lifecycle: auto-dismiss after a short delay, dismiss on
  // an outside click, and allow Escape. Clicks on a locked orb reposition it.
  useEffect(() => {
    if (!devBubble) return;
    const timer = window.setTimeout(() => setDevBubble(null), 3000);
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('.hub-orb-locked') || target?.closest('.hub-dev-bubble')) return;
      setDevBubble(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDevBubble(null);
    };
    document.addEventListener('click', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [devBubble]);

  const closeAbout = () => {
    setAboutOpen(false);
    logoBtnRef.current?.focus();
  };

  const handleOrbClick = (
    item: (typeof HUB_POSITIONS)[number],
    e: React.MouseEvent<HTMLButtonElement>
  ) => {
    // Locked sections stay visible but do not navigate — they surface the
    // development bubble instead.
    if (item.locked) {
      const ring = e.currentTarget.querySelector<HTMLElement>('.hub-ring');
      const rect = (ring ?? e.currentTarget).getBoundingClientRect();
      // Keep the bubble horizontally on-screen (estimated half-width clamp).
      const halfWidth = 130;
      const x = Math.min(
        Math.max(rect.left + rect.width / 2, halfWidth + 8),
        window.innerWidth - halfWidth - 8
      );
      if (item.pos === 'games') {
        // Below the top orb (its label sits above, so this stays clear).
        setDevBubble({ x, y: rect.bottom + 12, variant: 'below' });
      } else {
        // Above the left orb (its label sits below, so this stays clear).
        setDevBubble({ x, y: rect.top - 12, variant: 'above' });
      }
      return;
    }
    navigate(item.to);
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
          <button
            key={item.to}
            className={`hub-orb hub-orb-${item.pos}${item.locked ? ' hub-orb-locked' : ''}`}
            onClick={(e) => handleOrbClick(item, e)}
            aria-disabled={item.locked || undefined}
          >
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
      </div>

      {/* Development notification — a premium thought bubble anchored to the
          clicked locked orb. Never navigates; auto-dismisses. */}
      {devBubble && (
        <div
          className={`hub-dev-bubble hub-dev-bubble--${devBubble.variant}`}
          style={{ left: devBubble.x, top: devBubble.y }}
          role="status"
          aria-live="polite"
        >
          <span className="hub-dev-bubble-title">تحت التطوير</span>
          <span className="hub-dev-bubble-sub">غير متاحة حاليًا</span>
        </div>
      )}

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
