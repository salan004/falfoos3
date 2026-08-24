/**
 * Phase 12F — the owner's social/platform links.
 * Order is intentional (YouTube → Discord → TikTok → Kick → Donation);
 * the Links page renders this list as-is. Only real links belong here.
 */
export interface SocialLink {
  id: string;
  platform: string;
  icon: string;
  url: string;
  handle?: string;
}

export const SOCIAL_LINKS: SocialLink[] = [
  { id: 'youtube', platform: 'YouTube', icon: '/assets/images/social/youtube.png', url: 'https://www.youtube.com/@Falfoos', handle: '@Falfoos' },
  { id: 'discord', platform: 'Discord', icon: '/assets/images/social/discord.png', url: 'https://discord.gg/vR7DWBPqMT' },
  { id: 'tiktok', platform: 'TikTok', icon: '/assets/images/social/tiktok.png', url: 'https://www.tiktok.com/@falfoos', handle: '@falfoos' },
  { id: 'kick', platform: 'Kick', icon: '/assets/images/social/kick.png', url: 'https://kick.com/falfoos', handle: '@falfoos' },
  { id: 'donation', platform: 'Donation', icon: '/assets/images/social/donation.png', url: 'https://creators.sa/falfoos', handle: 'دعم FalFoos' },
];
