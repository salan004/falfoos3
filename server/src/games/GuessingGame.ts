import { BaseGame, GameConfig, ChatMessage, GamePhase, PlayerIdentity } from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';

interface Participant {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export class GuessingGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'guessing',
    name: 'لعبة التخمين',
    description: 'خمّن الإجابة المخفية عبر أمر !guess — أول إجابة صحيحة تفوز!',
    minPlayers: 1,
  };

  state: {
    phase: GamePhase;
    hints: string[];
    answer: string;
    winner: string | null;
    winnerId: string | null;
    participants: Participant[];
  } = {
    phase: 'idle',
    hints: [],
    answer: '',
    winner: null,
    winnerId: null,
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

  init(): void { this.newSessionId(); this.reset(); this.broadcastGameState(); }
  start(): void {
    this.state.phase = 'playing';
    this.state.winner = null;
    this.state.winnerId = null;
    this.broadcastGameState();
  }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', hints: [], answer: '', winner: null, winnerId: null, participants: [] };
  }

  handleChatMessage(msg: ChatMessage): void {
    if (this.state.phase !== 'playing' || this.state.winner) return;
    const match = normalizeChatCommand(msg.message).match(/^!\s*(?:guess|تخمين)\s+(.+)/i);
    if (!match) return;
    if (match[1].trim().toLowerCase() === this.state.answer.trim().toLowerCase()) {
      this.state.winner = msg.author;
      this.state.winnerId = msg.authorId;
      // The winning guess registers the viewer in the roster too.
      this.tryRegisterParticipant({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl });
      this.gameManagerRef?.updateScore(msg.authorId, msg.author, 200, msg.authorImageUrl, 'guessing:win');
      this.broadcast({ type: 'guessing:winner', payload: { winner: msg.author, winnerId: msg.authorId, answer: this.state.answer }, timestamp: Date.now() });
      // Phase 12A — round-scoped victory (per-game statistics only).
      this.announceWinners([msg.authorId], 'round');
      this.broadcastGameState();
    }
  }

  /**
   * Global !انضم entry point. Guessing has no lobby gate — viewers join the
   * participant roster at any time except after a round finished.
   */
  handleJoinCommand(identity: PlayerIdentity): void {
    if (this.state.phase === 'finished') {
      this.broadcast({
        type: 'game:joinRejected',
        payload: {
          gameId: this.config.id,
          playerId: identity.authorId,
          displayName: identity.displayName,
          reason: 'gameFinished',
          message: 'انتهت الجولة الحالية — بانتظار إعادة تعيين اللعبة.',
        },
        timestamp: Date.now(),
      });
      return;
    }

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
    if (command === 'guessing:setAnswer' && typeof payload === 'string') {
      this.state.answer = payload;
      this.state.winner = null;
      this.state.winnerId = null;
      if (this.state.phase === 'idle') this.start();
      else this.broadcastGameState();
      this.broadcast({ type: 'guessing:hint', payload: { hint: this.state.answer[0] }, timestamp: Date.now() });
    }
    if (command === 'guessing:reset') {
      this.reset();
      this.init();
    }
  }

  getPublicState(): Record<string, unknown> {
    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      hints: this.state.hints,
      // Secret stays server-side until the round is solved.
      answer: this.state.winner ? this.state.answer : '',
      winner: this.state.winner,
      winnerId: this.state.winnerId,
      playerCount: this.state.participants.length,
      participants: this.state.participants.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        // Phase 9E: only playing/winner exist in this game's actual rules —
        // per-guess correct/wrong history is not tracked (documented gap).
        status: this.state.winnerId === p.id ? 'winner' : 'playing',
      })),
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}
