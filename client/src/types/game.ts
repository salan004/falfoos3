import type { GameSettingsSchema } from './game-settings';

export interface GameConfig {
  id: string;
  name: string;
  description: string;
  settingsSchema?: GameSettingsSchema;
}

export type GamePhase = 'idle' | 'lobby' | 'playing' | 'paused' | 'finished';

export interface GameEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  score: number;
  /** Phase 9G foundation fields — optional, backwards compatible. */
  avatarUrl?: string;
  gameId?: string;
  sessionId?: string;
}

export interface GameState {
  gameId: string;
  phase: GamePhase;
  activeSettings?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatMessage {
  author: string;
  message: string;
  timestamp: number;
  authorId?: string;
  authorImageUrl?: string;
  isModerator?: boolean;
}

/** Minimal player shape shared across all game rooms. */
export interface GamePlayerSummary {
  id: string;
  displayName: string;
  avatarUrl?: string;
  /** Phase 9D contract — public, game-specific status (see each game's rules). */
  status?: string;
}

export interface TriviaPlayerSummary extends GamePlayerSummary {
  score?: number;
  correctAnswers?: number;
  wrongAnswers?: number;
  rank?: number | null;
}

export interface TriviaRankingEntry {
  id: string;
  displayName: string;
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
  avgResponseTimeMs: number;
}

export interface TriviaGameState extends GameState {
  roundNumber: number;
  totalRounds: number;
  category: string;
  currentQuestion: {
    question: string;
    choices: string[];
    category: string;
    difficulty: string;
  } | null;
  correctAnswer: string | null;
  timeLeft: number;
  roundFinished: boolean;
  totalAnswered: number;
  playerCount: number;
  players?: TriviaPlayerSummary[];
  ranking?: TriviaRankingEntry[];
}

export interface MusicalChairsGameState extends GameState {
  currentRound: number;
  chairsAvailable: number;
  players: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    sat: boolean;
    eliminated: boolean;
    joinedAt: number;
    status?: string;
  }[];
  winner: string | null;
}

export interface MafiaGameState extends GameState {
  players: { id: string; displayName: string; avatarUrl?: string; role: string; isAlive: boolean; status?: string }[];
  nightPhase: boolean;
  eliminatedToday: string | null;
  round: number;
  timerDuration: number;
  winner: 'mafia' | 'citizens' | null;
  votingStartTime: number;
  dayStartTime: number;
  nightStartTime: number;
  gameStartTime: number;
  votedCount: number;
  aliveCount: number;
  activeSettings: Record<string, unknown>;
}

export interface MafiaVoteTally {
  playerId: string;
  playerName: string;
  votes: number;
}

export interface MafiaVotingResultSnapshot {
  votes: MafiaVoteTally[];
  eliminated: string | null;
  tie: boolean;
  message: string;
}

export interface GuessingGameState extends GameState {
  hints: string[];
  answer: string;
  winner: string | null;
  winnerId?: string | null;
  playerCount?: number;
  participants?: GamePlayerSummary[];
}

export interface DrawingGameState extends GameState {
  grid: string[][];
  gridSize: number;
  currentWord: string;
  wordAnswered: boolean;
  wordWinner?: string | null;
  wordWinnerId?: string | null;
  playerCount?: number;
  participants?: GamePlayerSummary[];
}

export interface HideSeekGameState extends GameState {
  players: { id: string; displayName: string; avatarUrl?: string; zone: string | null; isCaught: boolean; status?: string }[];
  searchedZones: string[];
}

export interface YouTubeHealthSnapshot {
  pollsOk: number;
  pollsFailed: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  quotaExceeded: boolean;
}

export interface YouTubeConnectionStatus {
  connected: boolean;
  videoId?: string;
  channelName?: string;
  error?: string;
  /** Why the status changed: manual disconnect, poll-failure auto-drop, failed connect. */
  reason?: 'manual' | 'pollFailure' | 'connectFailed' | 'reconnectFailed';
  /** Phase 14 — supervised retry in progress after an unplanned drop. */
  reconnecting?: boolean;
  attempt?: number;
  maxAttempts?: number;
  health?: YouTubeHealthSnapshot;
}
