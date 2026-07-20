import { BaseGame, GameConfig, ChatMessage, GamePhase } from '../core/BaseGame';

export class GuessingGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'guessing',
    name: 'Guessing Game',
    description: 'Guess the hidden character, logo, or word via !guess. First correct answer wins!',
    minPlayers: 1,
  };

  state: { phase: GamePhase; hints: string[]; answer: string; winner: string | null } = {
    phase: 'idle',
    hints: [],
    answer: '',
    winner: null,
  };

  private gameManagerRef: { updateScore: (pid: string, name: string, delta: number) => void } | null;

  constructor(gameManager: { updateScore: (pid: string, name: string, delta: number) => void }) {
    super();
    this.gameManagerRef = gameManager;
  }

  init(): void { this.reset(); this.broadcastGameState(); }
  start(): void {
    this.state.phase = 'playing';
    this.state.winner = null;
    this.broadcastGameState();
  }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', hints: [], answer: '', winner: null };
  }

  handleChatMessage(msg: ChatMessage): void {
    if (this.state.phase !== 'playing' || this.state.winner) return;
    const match = msg.message.match(/^!guess\s+(.+)/i);
    if (!match) return;
    if (match[1].trim().toLowerCase() === this.state.answer.trim().toLowerCase()) {
      this.state.winner = msg.author;
      this.gameManagerRef?.updateScore(msg.authorId, msg.author, 200);
      this.broadcast({ type: 'guessing:winner', payload: { winner: msg.author, answer: this.state.answer }, timestamp: Date.now() });
      this.broadcastGameState();
    }
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    if (command === 'guessing:setAnswer' && typeof payload === 'string') {
      this.state.answer = payload;
      this.broadcast({ type: 'guessing:hint', payload: { hint: this.state.answer[0] }, timestamp: Date.now() });
    }
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: { gameId: this.config.id, ...this.state }, timestamp: Date.now() });
  }
}
