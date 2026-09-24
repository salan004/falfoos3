/**
 * SEO Fix 1 — canonical site constants and a tiny, dependency-free <head>
 * metadata writer.
 *
 * Only pure DOM operations are used (no react-helmet / SSR). Values are always
 * deterministic: the canonical URL is derived from the application path with
 * query/hash stripped, so arbitrary query strings can never create unbounded
 * canonical URLs.
 */

export const SITE_URL = 'https://falfoos.vercel.app';
export const SITE_NAME = 'FalFoos';
export const DEFAULT_TITLE = 'FalFoos — بطولات وألعاب الفلفوسيين';
export const DEFAULT_DESCRIPTION =
  'فلفوس منصة عربية للبطولات التنافسية والألعاب المباشرة: بطولات، تصنيفات، ملفات لاعبين، وبث يوتيوب تفاعلي.';
export const DEFAULT_IMAGE = `${SITE_URL}/assets/images/branding/falfoos-logo.png`;

export type RobotsDirective = 'index,follow' | 'noindex,nofollow';

export interface SeoMeta {
  title: string;
  description: string;
  /** Canonical application path (no query/hash), e.g. `/tournaments/abc`. */
  path: string;
  image?: string;
  type?: 'website' | 'article' | 'profile';
  robots?: RobotsDirective;
  /** Optional per-route JSON-LD objects (e.g. BreadcrumbList). */
  jsonLd?: Record<string, unknown>[];
}

/** Absolute canonical URL for a path; strips query/hash and trailing slashes. */
export function canonicalUrl(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  if (withSlash === '/') return `${SITE_URL}/`;
  return `${SITE_URL}${withSlash.replace(/\/+$/, '')}`;
}

function upsertMetaByName(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertMetaByProperty(property: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('property', property);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertCanonical(href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

const ROUTE_JSONLD_ID = 'falfoos-route-jsonld';

/** Applies route metadata to the live document head. Idempotent. */
export function applySeo(meta: SeoMeta): void {
  const title = meta.title || DEFAULT_TITLE;
  const description = meta.description || DEFAULT_DESCRIPTION;
  const canonical = canonicalUrl(meta.path);
  const image = meta.image || DEFAULT_IMAGE;
  const robots: RobotsDirective = meta.robots ?? 'index,follow';

  document.title = title;
  upsertMetaByName('description', description);
  upsertMetaByName('robots', robots);

  upsertMetaByProperty('og:site_name', SITE_NAME);
  upsertMetaByProperty('og:title', title);
  upsertMetaByProperty('og:description', description);
  upsertMetaByProperty('og:url', canonical);
  upsertMetaByProperty('og:type', meta.type ?? 'website');
  upsertMetaByProperty('og:image', image);
  upsertMetaByProperty('og:locale', 'ar_AR');

  upsertMetaByName('twitter:card', 'summary_large_image');
  upsertMetaByName('twitter:title', title);
  upsertMetaByName('twitter:description', description);
  upsertMetaByName('twitter:image', image);

  upsertCanonical(canonical);

  const existing = document.getElementById(ROUTE_JSONLD_ID);
  const jsonLd = meta.jsonLd ?? [];
  if (jsonLd.length === 0) {
    existing?.remove();
    return;
  }
  const script = (existing as HTMLScriptElement | null) ?? document.createElement('script');
  if (!existing) {
    script.type = 'application/ld+json';
    script.id = ROUTE_JSONLD_ID;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(jsonLd.length === 1 ? jsonLd[0] : jsonLd);
}

/** BreadcrumbList helper for a Home → section → detail hierarchy. */
export function breadcrumbList(
  items: { name: string; path: string }[]
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: canonicalUrl(item.path),
    })),
  };
}
