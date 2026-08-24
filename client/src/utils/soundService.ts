/**
 * Phase 12F — centralized sound service.
 *
 * Design rules (locked):
 * - Web Audio ONLY through this module; components never construct media
 *   elements or contexts themselves.
 * - Autoplay-safe: the AudioContext is created/resumed exclusively after the
 *   first real user gesture (pointerdown/keydown). Before unlock, every
 *   play request is silently dropped — sounds can never block gameplay.
 * - Fire-and-forget: decode/playback failures warn once and continue.
 * - Anti-noise: per-sound cooldown floor + small concurrent-voice cap.
 * - Mute/volume persist in localStorage; OBS/stream friendly (no BGM/loops).
 */

export type SoundName =
  | 'ui-click'
  | 'game-start'
  | 'countdown-tick'
  | 'countdown-final'
  | 'correct'
  | 'wrong'
  | 'round-end'
  | 'match-over'
  | 'transition';

const STORAGE_KEY = 'falfoos_sound';
const DEFAULT_VOLUME = 0.4;
const SAME_SOUND_COOLDOWN_MS = 120;
const MAX_VOICES = 4;
const ASSET_BASE = '/assets/audio/sfx';

interface PersistedPrefs {
  muted?: boolean;
  volume?: number;
}

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let unlocked = false;
let unlockInstalled = false;
let clickFeedbackInstalled = false;

/** Cached buffers; null marks a known-missing file (warned once). */
const bufferCache = new Map<SoundName, AudioBuffer | null>([]);
const lastPlayedAt = new Map<SoundName, number>([]);
let activeVoices = 0;

function readPrefs(): PersistedPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedPrefs) : {};
  } catch {
    return {};
  }
}

function writePrefs(patch: PersistedPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    // Storage may be unavailable (private mode) — prefs just won't persist.
  }
}

export function isSoundSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!((window as unknown as { AudioContext?: unknown }).AudioContext ??
      (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
  );
}

export function isSoundMuted(): boolean {
  return readPrefs().muted === true;
}

export function getSoundVolume(): number {
  const stored = readPrefs().volume;
  return typeof stored === 'number' && stored >= 0 && stored <= 1 ? stored : DEFAULT_VOLUME;
}

export function setSoundMuted(muted: boolean): void {
  writePrefs({ muted });
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(muted ? 0 : getSoundVolume(), ctx.currentTime, 0.01);
  }
}

export function setSoundVolume(volume: number): void {
  const clamped = Math.max(0, Math.min(1, volume));
  writePrefs({ volume: clamped });
  if (masterGain && ctx && !isSoundMuted()) {
    masterGain.gain.setTargetAtTime(clamped, ctx.currentTime, 0.01);
  }
}

function createCtx(): AudioContext | null {
  if (!isSoundSupported()) return null;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
  const instance = new Ctor();
  masterGain = instance.createGain();
  masterGain.gain.value = isSoundMuted() ? 0 : getSoundVolume();
  masterGain.connect(instance.destination);
  return instance;
}

/**
 * Installs the ONE-TIME gesture unlock. Called automatically on module mount;
 * safe to call again (idempotent). Before any gesture everything stays silent.
 */
export function installSoundUnlock(): void {
  if (!isSoundSupported() || unlockInstalled) return;
  unlockInstalled = true;
  const unlock = () => {
    if (!ctx) ctx = createCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
    if (ctx && ctx.state === 'running') unlocked = true;
    if (unlocked) {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      console.log('[sound] unlocked after user gesture');
    }
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Test/diagnostic visibility into the autoplay gate. */
export function isSoundUnlocked(): boolean {
  return unlocked;
}

async function loadBuffer(name: SoundName): Promise<AudioBuffer | null> {
  if (bufferCache.has(name)) return bufferCache.get(name) ?? null;
  if (!ctx) return null;
  try {
    const res = await fetch(`${ASSET_BASE}/${name}.wav`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    bufferCache.set(name, buffer);
    return buffer;
  } catch {
    bufferCache.set(name, null); // warned once below; never retried
    console.warn(`[sound] asset unavailable: ${name} (continuing silently)`);
    return null;
  }
}

/**
 * Plays a named sound. Never throws, never blocks: unsupported/muted/
 * locked/cooldown/missing all resolve to a silent no-op.
 */
export function playSound(name: SoundName): void {
  if (!unlocked || !ctx || !masterGain || isSoundMuted()) return;

  const now = performance.now();
  const last = lastPlayedAt.get(name) ?? -Infinity;
  if (now - last < SAME_SOUND_COOLDOWN_MS) return;
  if (activeVoices >= MAX_VOICES) return;
  lastPlayedAt.set(name, now);

  void loadBuffer(name).then((buffer) => {
    if (!buffer || !ctx || !masterGain) return;
    if (activeVoices >= MAX_VOICES) return;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(masterGain);
      activeVoices++;
      source.onended = () => {
        activeVoices--;
      };
      source.start();
    } catch (err) {
      activeVoices = Math.max(0, activeVoices - 1);
      console.warn('[sound] playback failed:', err instanceof Error ? err.message : err);
    }
  });
}

/**
 * Phase 12F-3 — global delegated UI click feedback. Installed ONCE; matches
 * interactive controls anywhere without touching individual components.
 * Elements marked data-sound="off" are excluded.
 */
export function installUiClickFeedback(): void {
  if (clickFeedbackInstalled || typeof document === 'undefined') return;
  clickFeedbackInstalled = true;
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const control = target.closest<HTMLElement>(
        "button:not(:disabled), [role='tab']:not([aria-disabled='true']), .btn-neon, .btn-neon-pink, .btn-solid-cyan"
      );
      if (!control || control.closest('[data-sound="off"]')) return;
      playSound('ui-click');
    },
    { capture: true }
  );
}
