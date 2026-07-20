export interface GameConfig {
  id: string;
  name: string;
  description: string;
  minPlayers?: number;
  maxPlayers?: number;
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
  message: string;
  timestamp: number;
  isModerator: boolean;
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

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  abstract init(): void | Promise<void>;
  abstract start(): void | Promise<void>;
  abstract stop(): void | Promise<void>;
  abstract reset(): void | Promise<void>;

  abstract handleChatMessage(msg: ChatMessage): void | Promise<void>;
  abstract handleAdminCommand(command: string, payload?: unknown): void | Promise<void>;
}
