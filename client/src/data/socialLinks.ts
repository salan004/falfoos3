/**
 * Phase 12 — the owner's social/platform links.
 * Edit this list to add or remove entries; the Links page renders it
 * automatically. Only real links belong here — never invent placeholders
 * that look live.
 */
export interface SocialLink {
  id: string;
  platform: string;
  icon: string;
  url: string;
  handle?: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  // Example shape (kept commented so the page shows its empty state):
  // { id: 'youtube', platform: 'YouTube', icon: '▶️', url: 'https://youtube.com/@...', handle: '@falfoos' },
];
