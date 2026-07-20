export interface GameConfig {
  id: string;
  name: string;
  description: string;
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
}

export interface GameState {
  gameId: string;
  phase: GamePhase;
  [key: string]: unknown;
}

export interface ChatMessage {
  author: string;
  message: string;
  timestamp: number;
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
}

export interface MusicalChairsGameState extends GameState {
  currentRound: number;
  chairsAvailable: number;
  players: {
    id: string;
    displayName: string;
    sat: boolean;
    eliminated: boolean;
    joinedAt: number;
  }[];
  winner: string | null;
}

export interface MafiaGameState extends GameState {
  players: { id: string; displayName: string; role: string; isAlive: boolean }[];
  nightPhase: boolean;
  eliminatedToday: string | null;
}

export interface GuessingGameState extends GameState {
  hints: string[];
  answer: string;
  winner: string | null;
}

export interface DrawingGameState extends GameState {
  grid: string[][];
  gridSize: number;
  currentWord: string;
  wordAnswered: boolean;
}

export interface HideSeekGameState extends GameState {
  players: { id: string; displayName: string; zone: string | null; isCaught: boolean }[];
  searchedZones: string[];
}
