import { useEffect } from 'react';
import { applySeo, type SeoMeta } from './seo';

/**
 * SEO Fix 1 — applies route metadata for the lifetime of the values.
 *
 * The meta object is serialized into the effect key so the head is rewritten
 * only when a value actually changes (not on every render).
 */
export function useSeo(meta: SeoMeta): void {
  const key = JSON.stringify(meta);
  useEffect(() => {
    applySeo(JSON.parse(key) as SeoMeta);
  }, [key]);
}
