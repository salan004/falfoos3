export interface GameDetails {
  howToPlay: string[];
  objective: string;
  winCondition: string;
  commands?: string[];
  chatInteraction?: string;
}

export interface GameCatalogEntry {
  icon: string;
  accent: string;
  nameAr?: string;
  descAr?: string;
  details?: GameDetails;
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
    nameAr: 'أسئلة عامة',
    descAr: 'أجب على أسئلة متعددة الخيارات عبر الدردشة — أسرع إجابة صحيحة تكسب!',
    artwork: '/assets/images/games/trivia.webp',
    artworkAlt: 'لوحة فنية للعبة الأسئلة',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة لدخول اللعبة',
        'اقرأ السؤال والخيارات الأربعة (1، 2، 3، 4) على الشاشة',
        'اكتب رقم إجابتك في الدردشة قبل انتهاء الوقت',
        'تكرر الجولات حتى تنتهي جميع الأسئلة المحددة'
      ],
      objective: 'أجب على أكبر عدد من الأسئلة بشكل صحيح',
      winCondition: 'اللاعب صاحب أعلى نقاط بعد انتهاء جميع الجولات يفوز',
      commands: ['!انضم', '1', '2', '3', '4'],
      chatInteraction: 'الإجابة عبر كتابة رقم الخيار (1-4) في دردشة البث'
    }
  },
  musical_chairs: {
    icon: '🎵',
    accent: 'var(--neon-pink)',
    nameAr: 'كراسي موسيقية',
    descAr: 'انضم للصالة، وعندما تتوقف الموسيقى اكتب !جلوس بسرعة — آخر من يبقى يفوز!',
    artwork: '/assets/images/games/musical_chairs.webp',
    artworkAlt: 'لوحة فنية للعبة الكراسي الموسيقية',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة للانضمام إلى الصالة (الأمر القديم !دخول يعمل أيضاً)',
        'انتظر المشرف ليفتح الصالة ثم يغلقها لبدء الجولة',
        'عندما تظهر رسالة "الموسيقى تتوقف قريباً"، استعد',
        'فور توقف الموسيقى، اكتب !جلوس بسرعة لتحجز كرسياً',
        'عدد الكراسي = عدد اللاعبين - 1، من لا يجد كرسي يُقصى',
        'تكرر الجولات حتى يبقى لاعب واحد فقط'
      ],
      objective: 'كن آخر لاعب يبقى على قيد الحياة',
      winCondition: 'آخر لاعب لم يُقصى يفوز باللعبة',
      commands: ['!انضم', '!دخول', '!جلوس'],
      chatInteraction: 'الانضمام عبر !انضم، والجلوس عبر !جلوس عند توقف الموسيقى'
    }
  },
  mafia: {
    icon: '🔪',
    accent: 'var(--neon-red)',
    nameAr: 'مافيا',
    descAr: 'لعبة أدوار سرية: مافيا تقتل ليلاً، مواطنون يصوتون نهاراً — فريق واحد ينتصر!',
    artwork: '/assets/images/games/mafia.webp',
    artworkAlt: 'لوحة فنية للعبة المافيا',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة للانضمام (يلزم 4 لاعبين على الأقل، حد أقصى 20)',
        'يوزع المشرف الأدوار سراً: مافيا، طبيب، محقق، مواطنون',
        'الليل: المافيا تختار ضحية (!اقتل)، الطبيب يشفي (!اشف)، المحقق يتحقق (!تحقق)',
        'النهار: يناقش اللاعبون علناً، ثم يصوتون لإقصاء مشتبه به (!صوت <اسم>)',
        'المُقصى يكشف دوره، وتكرر الجولات حتى يفوز فريق'
      ],
      objective: 'اعمل مع فريقك للقضاء على الفريق الخصم',
      winCondition: 'المواطنون يفوزون بإقصاء كل المافيا. المافيا تفوز بتحقيق التعادل أو الأغلبية',
      commands: ['!انضم', '!اقتل <اسم>', '!اشف <اسم>', '!تحقق <اسم>', '!صوت <اسم>'],
      chatInteraction: 'الأوامر السرية ليلاً عبر الرسائل الخاصة، التصويت نهاراً في الدردشة العامة'
    }
  },
  guessing: {
    icon: '🔮',
    accent: 'var(--neon-yellow)',
    nameAr: 'لعبة التخمين',
    descAr: 'حلّل التلميحات المتدرجة وخمّن الإجابة السرية — أول إجابة صحيحة تفوز فوراً!',
    artwork: '/assets/images/games/guessing.webp',
    artworkAlt: 'لوحة فنية للعبة التخمين',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة للمشاركة',
        'المض يحدد الإجابة السرية من لوحة التحكم',
        'تظهر التلميحات حرفاً بحرف على الشاشة',
        'اكتب !guess متبوعاً بتخمينك في الدردشة',
        'أول إجابة صحيحة تفوز وتنتهي اللعبة فوراً'
      ],
      objective: 'اكتشاف الإجابة السرية من التلميحات قبل غيرك',
      winCondition: 'أول لاعب يرسل الإجابة الصحيحة عبر !guess يفوز',
      commands: ['!انضم', '!guess <إجابتك>'],
      chatInteraction: 'التخمين عبر كتابة !guess متبوعاً بالإجابة في الدردشة'
    }
  },
  drawing: {
    icon: '🎨',
    accent: 'var(--neon-green)',
    nameAr: 'الرسم التفاعلي',
    descAr: 'لوّن بكسلات على شبكة مشتركة، أو خمّن الكلمة السرية — إبداع وتحدٍ معاً!',
    artwork: '/assets/images/games/drawing.webp',
    artworkAlt: 'لوحة فنية للعبة الرسم التفاعلي',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة للمشاركة',
        'المض يحدد الكلمة السرية من لوحة التحكم',
        'لوّن بكسلات عبر !draw B5 #ff00aa (إحداثي + كود اللون)',
        'جميع اللاعبون يرسمون على نفس الشبكة المشتركة',
        'خمّن الكلمة عبر !guess في أي وقت',
        'عند تخمين الكلمة بشكل صحيح، تظهر الكلمة ويفوز المخمن'
      ],
      objective: 'ارسم لتوضيح الكلمة، أو خمّن الكلمة من الرسم',
      winCondition: 'أول لاعب يخمن الكلمة السرية عبر !guess يفوز',
      commands: ['!انضم', '!draw <إحداثي> <لون>', '!guess <كلمة>'],
      chatInteraction: 'الرسم عبر !draw مع إحداثي ولون هكس، التخمين عبر !guess'
    }
  },
  hide_and_seek: {
    icon: '👻',
    accent: 'var(--neon-purple)',
    nameAr: 'الغميضة',
    descAr: 'اختبئ في واحدة من 16 منطقة، والمضيف يفتش — من يُكتشف يُقصى، آخر مختبئ يفوز!',
    artwork: '/assets/images/games/hide_and_seek.webp',
    artworkAlt: 'لوحة فنية للعبة الغميضة',
    details: {
      howToPlay: [
        'اكتب !انضم في الدردشة للانضمام',
        'المض يبدأ مرحلة الاختباء من لوحة التحكم',
        'اختر منطقة واختبئ عبر !hide A1 (المناطق: A1-D4، شبكة 4×4)',
        'المضيف يفتش المناطق واحدة واحدة من لوحة التحكم',
        'من يُكتشف في المنطقة المُفتشة يُقصى ويُظهر اسمه',
        'المناطق الآمنة تظهر ✓، ومناطق المضبوطين تظهر ☠ مع الأسماء',
        'آخر مختبئ(ين) يفوزون عند انتهاء التفتيش'
      ],
      objective: 'اختبئ في منطقة لا يفتشها المضيف',
      winCondition: 'اللاعبون الذين لم يُكتشفوا عند انتهاء تفتيش جميع المناطق يفوزون',
      commands: ['!انضم', '!hide <منطقة>'],
      chatInteraction: 'الاختباء عبر !hide متبوعاً برمز المنطقة (مثال: !hide B3)'
    }
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

