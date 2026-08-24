import { useEffect } from 'react';

/**
 * Phase 12F — tether ATTACHMENT restoration (v3 post-pivot-fix model).
 *
 * The v5 axis-aligned experiment computed anchors via cross-frame rect
 * arithmetic (stage rects − button rects − bob offsets) and consumed them
 * as absolute left/top inside the button. Any error in that chain teleported
 * the whole arc elsewhere on the page. This version returns to the PROVEN
 * attachment system:
 *
 * - Anchors come from offsetLeft/offsetTop INSIDE the button — pure layout
 *   values that cannot drift with scroll, zoom, or ancestor transforms.
 * - Orientation comes from ONE rotate() around a correctly pinned origin
 *   (transform-origin: 0 calc(var(--tht)/2)) — visually confirmed working.
 * - The svg stays a child of the orb button → bob-follow is native.
 *
 * Endpoints: deflated-core projection (never inside artwork) → ring tuck
 * point beneath the glass. Subtle petal biases only; stronger curvature is
 * a LATER step, gated on visual confirmation of attachment.
 *
 * Perf contract unchanged: initial post-paint rAF + ResizeObserver +
 * resize + fonts.ready. No JS animation loops.
 */

const ORB_KEYS = ['games', 'leaderboard', 'links', 'soon'] as const;

/** Straight radial connectors: slim constant box height (stroke + glow fit;
 *  overflow:visible lets them extend without clipping). */
const TETHER_THICKNESS = 6;

const LOGO_INSET = 3; // deflate the core bbox — tip never touches artwork
const RING_TUCK = 6; // hide the path end this many px under the glass ring

let warnedBadGeometry = false;

function parseBobOffset(computedTranslate: string): { x: number; y: number } {
  if (!computedTranslate || computedTranslate === 'none') return { x: 0, y: 0 };
  const parts = computedTranslate.split(/\s+/).map((v) => parseFloat(v));
  return {
    x: Number.isFinite(parts[0]) ? parts[0] : 0,
    y: Number.isFinite(parts[1]) ? parts[1] : 0,
  };
}

function measureAndApply(): void {
  const stage = document.querySelector<HTMLElement>('.hub-stage');
  const core = document.querySelector<HTMLElement>('.hub-core');
  if (!stage || !core) return;

  const stageRect = stage.getBoundingClientRect();
  const coreRect = core.getBoundingClientRect();
  // Logo center in stage-local coordinates (core never bobs).
  const cx = coreRect.left + coreRect.width / 2 - stageRect.left;
  const cy = coreRect.top + coreRect.height / 2 - stageRect.top;

  for (const key of ORB_KEYS) {
    const button = document.querySelector<HTMLElement>(`.hub-orb-${key}`);
    const tether = document.querySelector<SVGSVGElement>(`.hub-tether[data-to="${key}"]`);
    const ring = button?.querySelector<HTMLElement>('.hub-ring');
    if (!button || !tether || !ring) continue;

    // Live bob offset of THIS orb (its own animation delay/phase).
    const bob = parseBobOffset(getComputedStyle(button).translate);

    // REST ring center in stage-local space.
    const ringRect = ring.getBoundingClientRect();
    const ringR = ringRect.width / 2;
    const rx = ringRect.left + ringR - bob.x - stageRect.left;
    const ry = ringRect.top + ringR - bob.y - stageRect.top;

    // Unit vector logo-center → rest-ring-center.
    let dx = rx - cx;
    let dy = ry - cy;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist;
    dy /= dist;

    // START: logo bbox edge, bbox deflated so the tip never touches artwork.
    const hw = Math.max(0, coreRect.width / 2 - LOGO_INSET);
    const hh = Math.max(0, coreRect.height / 2 - LOGO_INSET);
    const sEdge = Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
    const sx = cx + dx * sEdge;
    const sy = cy + dy * sEdge;

    // END: tucked RING_TUCK px under the glass ring, logo-facing side.
    const ex = rx - dx * Math.max(0, ringR - RING_TUCK);
    const ey = ry - dy * Math.max(0, ringR - RING_TUCK);

    // Rotated local frame: origin = END (ring side), +X toward START (logo).
    const len = Math.max(0, Math.hypot(sx - ex, sy - ey));
    if (!(len > 2)) continue; // degenerate — skip safely
    const angle = (Math.atan2(sy - ey, sx - ex) * 180) / Math.PI;

    // STRAIGHT radial connector (final): one segment, logo edge → ring tuck.
    const tht = TETHER_THICKNESS;

    // Local coords: y0 = vertical midline; start at x=len, end at x=0.
    const y0 = tht / 2;
    const d = `M ${len.toFixed(1)} ${y0} L 0 ${y0}`;

    // Anchor INSIDE the BUTTON's local box (layout offsets ignore transforms
    // AND cannot drift across coordinate frames).
    const ax = ring.offsetLeft + ring.offsetWidth / 2;
    const ay = ring.offsetTop + ring.offsetHeight / 2;

    // Defensive gate: never write invalid geometry.
    if (![ax, ay, len, angle, tht].every(Number.isFinite)) {
      if (!warnedBadGeometry) {
        warnedBadGeometry = true;
        console.warn('[tether] non-finite geometry for', key, { ax, ay, len, angle });
      }
      continue;
    }

    tether.style.setProperty('--tx', `${ax}px`);
    tether.style.setProperty('--ty', `${ay}px`);
    tether.style.setProperty('--tw', `${Math.ceil(len) + 2}px`);
    tether.style.setProperty('--tht', `${tht}px`);
    tether.style.setProperty('--tang', `${angle}deg`);

    const basePath = tether.querySelector<SVGPathElement>('.hub-tether-line');
    if (basePath) basePath.setAttribute('d', d);
    const haloPath = tether.querySelector<SVGPathElement>('.hub-tether-halo');
    if (haloPath) haloPath.setAttribute('d', d);
    const pulsePath = tether.querySelector<SVGPathElement>('.hub-tether-pulse');
    if (pulsePath) pulsePath.setAttribute('d', d);
  }
}

export function useHubTethers(): void {
  useEffect(() => {
    let raf = 0;
    raf = requestAnimationFrame(measureAndApply);

    const stage = document.querySelector<HTMLElement>('.hub-stage');
    const observer = typeof ResizeObserver !== 'undefined' && stage ? new ResizeObserver(measureAndApply) : null;
    if (observer && stage) observer.observe(stage);

    window.addEventListener('resize', measureAndApply);
    if (document.fonts?.ready) void document.fonts.ready.then(measureAndApply).catch(() => undefined);

    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', measureAndApply);
    };
  }, []);
}
