import { useSeo } from './useSeo';
import { DEFAULT_DESCRIPTION, DEFAULT_TITLE, type SeoMeta } from './seo';

/**
 * SEO Fix 1 — baseline per-route metadata.
 *
 * Rendered as the FIRST child of the main app so its effect runs before page
 * components; a page that fetches real data can then override these values via
 * `useSeo(...)` once its data is available.
 *
 * Private surfaces (dashboard, register, stream overlay) are `noindex`.
 */

const STATIC_ROUTES: Record<string, { title: string; description: string }> = {
  '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION },
  '/games': {
    title: 'الألعاب | FalFoos',
    description: 'استعرض ألعاب منصة فلفوس والبطولات المتاحة لكل لعبة.',
  },
  '/stream-games': {
    title: 'ألعاب البث | FalFoos',
    description: 'ألعاب البث التفاعلية على منصة فلفوس مع بث يوتيوب المباشر.',
  },
  '/leaderboard': {
    title: 'المتصدرون | FalFoos',
    description: 'لوحة متصدري منصة فلفوس ونقاط اللاعبين.',
  },
  '/links': {
    title: 'روابط التواصل | FalFoos',
    description: 'روابط قنوات ومنصات فلفوس الرسمية.',
  },
  '/connect': {
    title: 'ربط بث يوتيوب | FalFoos',
    description: 'اربط بث يوتيوب المباشر لتفاعل المشاهدين مع ألعاب فلفوس.',
  },
};

const NOINDEX_EXACT = new Set(['/register']);

function isNoIndex(path: string): boolean {
  if (NOINDEX_EXACT.has(path)) return true;
  if (path === '/dashboard' || path.startsWith('/dashboard/')) return true;
  if (path.startsWith('/broadcast/')) return true;
  return false;
}

export function RouteSeo({ path }: { path: string }) {
  const clean = path.split('?')[0];
  const fallback = STATIC_ROUTES[clean] ?? { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION };
  const meta: SeoMeta = isNoIndex(clean)
    ? { title: fallback.title, description: fallback.description, path: clean, robots: 'noindex,nofollow' }
    : { ...fallback, path: clean };
  useSeo(meta);
  return null;
}
