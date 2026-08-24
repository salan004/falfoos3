export interface GameCatalogEntry {
  icon: string;
  accent: string;
  nameAr?: string;
  descAr?: string;
  /** Phase 10C: optional card artwork served from /assets (public dir). */
  artwork?: string;
  artworkAlt?: string;
}

/**
 * Artwork convention: drop a file at client/public/assets/images/games/<id>.webp
 * and it is picked up with ZERO code changes. Until a file exists, GameCardArtwork
 * renders the accent-driven CSS-gradient scene fallback.
 */
export const GAMES_CATALOG: Record<string, GameCatalogEntry> = {
  trivia: {
    icon: '🎯',
    accent: 'var(--neon-cyan)',
    artwork: '/assets/images/games/trivia.webp',
    artworkAlt: 'لوحة فنية للعبة الأسئلة',
  },
  musical_chairs: {
    icon: '🎵',
    accent: 'var(--neon-pink)',
    artwork: '/assets/images/games/musical_chairs.webp',
    artworkAlt: 'لوحة فنية للعبة الكراسي الموسيقية',
  },
  mafia: {
    icon: '🔪',
    accent: 'var(--neon-red)',
    artwork: '/assets/images/games/mafia.webp',
    artworkAlt: 'لوحة فنية للعبة المافيا',
  },
  guessing: {
    icon: '🔮',
    accent: 'var(--neon-yellow)',
    nameAr: 'لعبة التخمين',
    descAr: 'حلّل التلميحات وخمّن الإجابة السرية عبر !guess — أول إجابة صحيحة تفوز!',
    artwork: '/assets/images/games/guessing.webp',
    artworkAlt: 'لوحة فنية للعبة التخمين',
  },
  drawing: {
    icon: '🎨',
    accent: 'var(--neon-green)',
    nameAr: 'الرسم التفاعلي',
    descAr: 'لوِّن شبكة البكسلات عبر أمر !draw، أو خمّن الكلمة المطلوبة عبر !guess.',
    artwork: '/assets/images/games/drawing.webp',
    artworkAlt: 'لوحة فنية للعبة الرسم التفاعلي',
  },
  hide_and_seek: {
    icon: '👻',
    accent: 'var(--neon-purple)',
    nameAr: 'الغميضة',
    descAr: 'اختبئ في منطقة عبر أمر !hide A1 — المضيف يفتّش المناطق ومن يُكتشف يُقصى!',
    artwork: '/assets/images/games/hide_and_seek.webp',
    artworkAlt: 'لوحة فنية للعبة الغميضة',
  },
};

export interface GameRegistryEntry {
  id: string;
  name: string;
  description: string;
}

export function resolveGameName(game: GameRegistryEntry): string {
  return GAMES_CATALOG[game.id]?.nameAr ?? game.name;
}

export function resolveGameDescription(game: GameRegistryEntry): string {
  return GAMES_CATALOG[game.id]?.descAr ?? game.description;
}

/** Phase 10C: artwork path + Arabic alt text for a game id, if cataloged. */
export function resolveGameArtwork(gameId: string): { src: string; alt: string } | null {
  const entry = GAMES_CATALOG[gameId];
  if (!entry?.artwork) return null;
  return { src: entry.artwork, alt: entry.artworkAlt ?? `${entry.nameAr ?? gameId} — صورة الفن` };
}

export const PHASE_LABELS_AR: Record<string, string> = {
  idle: 'في الانتظار',
  lobby: 'في الصالة',
  playing: 'قيد اللعب',
  paused: 'متوقفة مؤقتاً',
  finished: 'انتهت للتو',
};

import type { GameState } from '../types/game';

export function readPlayerCount(state: GameState | null): number | null {
  if (!state) return null;
  for (const key of ['aliveCount', 'playerCount']) {
    const value = state[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

