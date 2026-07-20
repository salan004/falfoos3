import { BaseGame, GameConfig, ChatMessage, GamePhase } from '../core/BaseGame';

export class DrawingGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'drawing',
    name: 'Interactive Drawing',
    description: 'Collaborative pixel grid or Pictionary-style drawing with chat commands.',
    minPlayers: 1,
  };

  state: { phase: GamePhase; grid: string[][]; gridSize: number; currentWord: string; wordAnswered: boolean } = {
    phase: 'idle',
    grid: [],
    gridSize: 16,
    currentWord: '',
    wordAnswered: false,
  };

  private gameManagerRef: { updateScore: (pid: string, name: string, delta: number) => void } | null;

  constructor(gameManager: { updateScore: (pid: string, name: string, delta: number) => void }) {
    super();
    this.gameManagerRef = gameManager;
  }

  init(): void {
    this.reset();
    this.state.grid = Array.from({ length: this.state.gridSize }, () => Array(this.state.gridSize).fill('#000000'));
    this.broadcastGameState();
  }

  start(): void { this.state.phase = 'playing'; this.broadcastGameState(); }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', grid: [], gridSize: 16, currentWord: '', wordAnswered: false };
  }

  handleChatMessage(msg: ChatMessage): void {
    const drawMatch = msg.message.match(/^!draw\s+([A-Za-z]\d+)\s+(#[0-9A-Fa-f]{6}|[a-z]+)/i);
    if (drawMatch && this.state.phase === 'playing') {
      const coord = drawMatch[1].toUpperCase();
      const col = coord.charCodeAt(0) - 65;
      const row = parseInt(coord.slice(1), 10) - 1;
      const color = drawMatch[2];
      if (col >= 0 && col < this.state.gridSize && row >= 0 && row < this.state.gridSize) {
        this.state.grid[row][col] = color;
        this.broadcast({ type: 'drawing:pixelUpdate', payload: { row, col, color }, timestamp: Date.now() });
      }
      return;
    }
    if (this.state.currentWord && !this.state.wordAnswered) {
      const guessMatch = msg.message.match(/^!guess\s+(.+)/i);
      if (guessMatch && guessMatch[1].trim().toLowerCase() === this.state.currentWord.toLowerCase()) {
        this.state.wordAnswered = true;
        this.gameManagerRef?.updateScore(msg.authorId, msg.author, 150);
        this.broadcast({ type: 'drawing:wordGuessed', payload: { winner: msg.author, word: this.state.currentWord }, timestamp: Date.now() });
      }
    }
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    if (command === 'drawing:setWord' && typeof payload === 'string') {
      this.state.currentWord = payload;
      this.state.wordAnswered = false;
    }
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: { gameId: this.config.id, ...this.state }, timestamp: Date.now() });
  }
}
