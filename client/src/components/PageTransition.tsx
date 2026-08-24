import { useEffect, useRef, useState } from 'react';
import { useHashRoute } from '../hooks/useHashRoute';
import { BrandLogo } from './BrandLogo';

/**
 * Phase 12d — DIRECTIONAL brand page transition.
 *
 * Direction mirrors the Hub orb that leads to the destination:
 *   /games ↑ up   ·   /leaderboard ← left   ·   /links → right
 * All other destinations use the neutral centered fade. The overlay
 * counter-drifts in from the opposite side, settles, then exits toward
 * the destination — "moving toward where you're going" without ever
 * sliding the whole page violently.
 *
 * Safety: timer-guaranteed completion; rapid navigation restarts cleanly
 * via effect cleanup. Reduced motion: short plain fade + static Loading.
 */

type Direction = 'up' | 'left' | 'right';

const ROUTE_DIRECTION: Record<string, Direction> = {
  '/games': 'up',
  '/leaderboard': 'left',
  '/links': 'right',
};

const NORMAL_HOLD_MS = 600;
const EXIT_MS = 400;
const REDUCED_HOLD_MS = 150;
const REDUCED_EXIT_MS = 150;

type Phase = 'idle' | 'active' | 'leaving';

export function PageTransition() {
  const { path } = useHashRoute();
  const [phase, setPhase] = useState<Phase>('idle');
  const [direction, setDirection] = useState<Direction | null>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    setDirection(ROUTE_DIRECTION[path] ?? null);
    setPhase('active');
    const hold = reduced ? REDUCED_HOLD_MS : NORMAL_HOLD_MS;
    const exit = reduced ? REDUCED_EXIT_MS : EXIT_MS;
    const t1 = setTimeout(() => setPhase('leaving'), hold);
    const t2 = setTimeout(() => setPhase('idle'), hold + exit);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [path]);

  if (phase === 'idle') return null;

  const dirClass = direction ? ` dir-${direction}` : '';

  return (
    <div
      className={`route-transition${phase === 'leaving' ? ' is-leaving' : ''}${dirClass}`}
      aria-hidden="true"
    >
      <div className="route-transition-core">
        <div className="route-transition-halo" aria-hidden />
        <BrandLogo size={150} className="route-transition-logo" wordmarkFallback={false} />
        <div className="route-loading">
          Loading
          <span className="rt-dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}
