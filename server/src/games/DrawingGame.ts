import { BaseGame, GameConfig, ChatMessage, GamePhase, PlayerIdentity } from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';

interface Participant {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export class DrawingGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'drawing',
    name: 'الرسم التفاعلي',
    description: 'لوِّن شبكة البكسلات عبر أمر !draw، أو خمّن الكلمة المطلوبة عبر !guess.',
    minPlayers: 1,
  };

  state: {
    phase: GamePhase;
    grid: string[][];
    gridSize: number;
    currentWord: string;
    wordAnswered: boolean;
    wordWinner: string | null;
    /** Phase 9E: stable id companion to the legacy name-only wordWinner. */
    wordWinnerId: string | null;
    participants: Participant[];
  } = {
    phase: 'idle',
    grid: [],
    gridSize: 16,
    currentWord: '',
    wordAnswered: false,
    wordWinner: null,
    wordWinnerId: null,
    participants: [],
  };

  private gameManagerRef: {
    updateScore: (pid: string, name: string, delta: number, avatarUrl?: string, reason?: string) => void;
  } | null;

  constructor(gameManager: {
    updateScore: (pid: string, name: string, delta: number, avatarUrl?: string, reason?: string) => void;
  }) {
    super();
    this.gameManagerRef = gameManager;
  }

  init(): void {
    this.newSessionId();
    this.reset();
    this.state.grid = Array.from({ length: this.state.gridSize }, () => Array(this.state.gridSize).fill('#000000'));
    this.broadcastGameState();
  }

  start(): void { this.state.phase = 'playing'; this.broadcastGameState(); }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', grid: [], gridSize: 16, currentWord: '', wordAnswered: false, wordWinner: null, wordWinnerId: null, participants: [] };
  }

  handleChatMessage(msg: ChatMessage): void {
    const drawMatch = normalizeChatCommand(msg.message).match(/^!\s*draw\s+([A-Za-z]\d+)\s+(#[0-9A-Fa-f]{6}|[a-z]+)/i);
    if (drawMatch && this.state.phase === 'playing') {
      const coord = drawMatch[1].toUpperCase();
      const col = coord.charCodeAt(0) - 65;
      const row = parseInt(coord.slice(1), 10) - 1;
      const color = drawMatch[2];
      if (col >= 0 && col < this.state.gridSize && row >= 0 && row < this.state.gridSize) {
        // Drawing registers the viewer in the participant roster too.
        this.tryRegisterParticipant({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl });
        this.state.grid[row][col] = color;
        this.broadcast({ type: 'drawing:pixelUpdate', payload: { row, col, color }, timestamp: Date.now() });
      }
      return;
    }
    if (this.state.currentWord && !this.state.wordAnswered) {
      const guessMatch = normalizeChatCommand(msg.message).match(/^!\s*guess\s+(.+)/i);
      if (guessMatch && guessMatch[1].trim().toLowerCase() === this.state.currentWord.toLowerCase()) {
        this.state.wordAnswered = true;
        this.state.wordWinner = msg.author;
        this.state.wordWinnerId = msg.authorId;
        this.tryRegisterParticipant({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl });
        this.gameManagerRef?.updateScore(msg.authorId, msg.author, 150, msg.authorImageUrl, 'drawing:wordGuessed');
        // Phase 12A — winnerId joins the payload so the result is auditable.
        this.broadcast({ type: 'drawing:wordGuessed', payload: { winner: msg.author, winnerId: msg.authorId, word: this.state.currentWord }, timestamp: Date.now() });
        // Phase 12A — round-scoped victory (per-game statistics only).
        this.announceWinners([msg.authorId], 'round');
        this.broadcastGameState();
      }
    }
  }

  /**
   * Global !انضم entry point. Drawing has no lobby gate — viewers join the
   * participant roster at any time.
   */
  handleJoinCommand(identity: PlayerIdentity): void {
    if (this.tryRegisterParticipant(identity)) {
      this.broadcastGameState();
    }
  }

  /** Returns true when the viewer was newly registered. */
  private tryRegisterParticipant(identity: PlayerIdentity): boolean {
    const outcome = this.tryRegisterPlayer(this.state.participants, identity, () => ({
      id: identity.authorId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    }));
    if (outcome === 'added') {
      this.broadcast({
        type: 'game:playerJoined',
        payload: {
          gameId: this.config.id,
          playerId: identity.authorId,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          playerCount: this.state.participants.length,
        },
        timestamp: Date.now(),
      });
      return true;
    }
    return false;
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    if (command === 'drawing:setWord' && typeof payload === 'string') {
      this.state.currentWord = payload;
      this.state.wordAnswered = false;
      this.state.wordWinner = null;
      if (this.state.phase === 'idle') this.start();
      else this.broadcastGameState();
    }
    if (command === 'drawing:reset') {
      this.init();
    }
  }

  getPublicState(): Record<string, unknown> {
    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      grid: this.state.grid,
      gridSize: this.state.gridSize,
      // Secret word stays server-side until solved.
      currentWord: this.state.wordAnswered ? this.state.currentWord : '',
      wordAnswered: this.state.wordAnswered,
      wordWinner: this.state.wordWinner,
      wordWinnerId: this.state.wordWinnerId,
      playerCount: this.state.participants.length,
      participants: this.state.participants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        // Phase 9E: the game's rules only define drawing + solved-by-guesser;
        // submission/wrong tracking does not exist (documented gap).
        status: this.state.wordWinnerId === p.id ? 'correct' : 'drawing',
      })),
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}
