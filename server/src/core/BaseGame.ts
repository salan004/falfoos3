export interface GameSettingDefinition {
  key: string;
  label: string;
  labelAr: string;
  type: 'number' | 'select' | 'boolean';
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: unknown; label: string; labelAr: string }[];
  validation?: (value: unknown, allSettings: Record<string, unknown>) => string | null;
}

export interface GameSettingsSchema {
  gameId: string;
  settings: GameSettingDefinition[];
}

export interface GameConfig {
  id: string;
  name: string;
  description: string;
  minPlayers?: number;
  maxPlayers?: number;
  settingsSchema?: GameSettingsSchema;
}

export type GamePhase = 'idle' | 'lobby' | 'playing' | 'paused' | 'finished';

/**
 * Phase 12A — winner scope for the standardized `game:finished` event.
 * 'match' → full-activation victory (Profile "Wins" statistic)
 * 'round' → single-round victory (per-game statistics only)
 */
export type WinnerScope = 'match' | 'round';

export interface PlayerState {
  id: string;
  displayName: string;
  isAlive: boolean;
  joinedAt: number;
  metadata: Record<string, unknown>;
}

export interface ChatMessage {
  author: string;
  authorId: string;
  authorImageUrl?: string;
  message: string;
  timestamp: number;
  isModerator: boolean;
  socketId?: string;
}

/** Clean viewer identity extracted from YouTube Live Chat author data. */
export interface PlayerIdentity {
  authorId: string;
  displayName: string;
  avatarUrl?: string;
  /** Socket.IO socket id when the message came from a local/test client. */
  socketId?: string;
}

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export type BroadcastFn = (event: GameEvent) => void;

export abstract class BaseGame {
  abstract readonly config: GameConfig;
  abstract state: any;

  protected broadcast: BroadcastFn = () => {};
  protected matchSettings: Record<string, unknown> = {};
  protected editableSettings: Record<string, unknown> = {};

  /**
   * Phase 9F: identity of the CURRENT game session (one activation of this
   * game). Regenerated only when init() runs — i.e. on switchGame or an
   * explicit reset command — never when a viewer merely opens a page.
   */
  protected sessionId = '';

  /** Public read access for GameManager/leaderboard enrichment. */
  getSessionId(): string {
    return this.sessionId;
  }

  protected newSessionId(): void {
    this.sessionId = randomUUID();
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  /**
   * Phase 12A — the ONE way games report results. GameManager intercepts the
   * emitted `game:finished` event to persist winners additively (and, for
   * scope='match', to stamp the match's ended_at). Gameplay is untouched:
   * persistence failures are logged by GameManager and never thrown here.
   *
   * Trivia intentionally never announces round winners (multiple players
   * score per question); Hide & Seek has no winner concept at all.
   */
  protected announceWinners(winnerIds: string[], scope: WinnerScope): void {
    const ids = (Array.isArray(winnerIds) ? winnerIds : []).filter(
      (id) => typeof id === 'string' && id.length > 0
    );
    if (ids.length === 0) return;
    this.broadcast({
      type: 'game:finished',
      payload: { winnerIds: ids, scope },
      timestamp: Date.now(),
    });
  }

  /**
   * Public, serializable snapshot of the game state for clients.
   * MUST contain no secrets (answers/words/roles), Maps, or timers —
   * this is the ONLY shape ever broadcast or sent to new connections.
   */
  abstract getPublicState(): Record<string, unknown>;

  /**
   * Optional handler for the GLOBAL !انضم command. GameManager routes every
   * join attempt for the active game here with a clean viewer identity.
   * Implementations must broadcast feedback themselves (game:playerJoined /
   * game:joinRejected) plus their updated game state.
   */
  handleJoinCommand?(identity: PlayerIdentity): void;

  /**
   * Shared duplicate/capacity guard so games don't re-implement join rules.
   * Only mutates the list when it returns 'added'.
   */
  protected tryRegisterPlayer<T extends { id: string }>(
    list: T[],
    identity: PlayerIdentity,
    create: () => T,
    max?: number
  ): 'added' | 'duplicate' | 'full' {
    if (max !== undefined && list.length >= max) return 'full';
    if (list.some((p) => p.id === identity.authorId)) return 'duplicate';
    list.push(create());
    return 'added';
  }

  getSettingsSchema(): GameSettingsSchema {
    return this.config.settingsSchema ?? { gameId: this.config.id, settings: [] };
  }

  setMatchSettings(settings: Record<string, unknown>): void {
    this.matchSettings = { ...settings };
  }

  getMatchSettings(): Record<string, unknown> {
    return this.matchSettings;
  }

  getEditableSettings(): Record<string, unknown> {
    return this.editableSettings;
  }

  setEditableSettings(settings: Record<string, unknown>): void {
    this.editableSettings = { ...settings };
  }

  getEffectiveSetting(key: string): unknown {
    if (key in this.matchSettings) {
      return this.matchSettings[key];
    }
    if (key in this.editableSettings) {
      return this.editableSettings[key];
    }
    const schema = this.getSettingsSchema();
    const setting = schema.settings.find((s) => s.key === key);
    return setting?.default;
  }

  hasMatchSettings(): boolean {
    return Object.keys(this.matchSettings).length > 0;
  }

  clearMatchSettings(): void {
    this.matchSettings = {};
  }

  abstract init(): void | Promise<void>;
  abstract start(): void | Promise<void>;
  abstract stop(): void | Promise<void>;
  abstract reset(): void | Promise<void>;

  abstract handleChatMessage(msg: ChatMessage): void | Promise<void>;
  abstract handleAdminCommand(command: string, payload?: unknown): void | Promise<void>;
}

function randomUUID(): string {
  // Local helper keeps BaseGame dependency-free; Node >=16.7 provides this.
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
