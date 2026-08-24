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
