import { BaseGame, GameConfig, ChatMessage, GamePhase, PlayerIdentity } from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';

interface MusicalChairsPlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  sat: boolean;
  eliminated: boolean;
  joinedAt: number;
}

interface MusicalChairsState {
  phase: GamePhase;
  players: Map<string, MusicalChairsPlayer>;
  currentRound: number;
  chairsAvailable: number;
  totalPlayersStart: number;
  seatingStartTime: number;
  seatingDuration: number;
  winner: string | null;
}

export class MusicalChairsGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'musical_chairs',
    name: 'كراسي موسيقية',
    description: 'اكتب !دخول للانضمام إلى اللعبة. عندما يتوقف المؤقت، اكتب !جلوس بسرعة لتحجز كرسياً!',
    minPlayers: 2,
  };

  state: MusicalChairsState = this.initialState();

  /**
   * Single managed handle for the seating window. Both the full-duration timer
   * and the early "all seats filled" path route through it, so endSeating can
   * never run twice (the old double-elimination race).
   */
  private seatingTimer: NodeJS.Timeout | null = null;
  private seatingActive = false;

  private initialState(): MusicalChairsState {
    return {
      phase: 'idle',
      players: new Map(),
      currentRound: 0,
      chairsAvailable: 0,
      totalPlayersStart: 0,
      seatingStartTime: 0,
      seatingDuration: 10,
      winner: null,
    };
  }

  init(): void {
    this.newSessionId();
    this.reset();
    this.broadcastGameState();
  }

  start(): void {
    if (this.state.phase !== 'idle') return;
    this.state.phase = 'lobby';
    this.broadcast({ type: 'mc:lobbyOpen', payload: {}, timestamp: Date.now() });
    this.broadcastGameState();
  }

  stop(): void {
    this.clearSeatingTimer();
    this.state.phase = 'idle';
    this.broadcast({ type: 'mc:stopped', payload: {}, timestamp: Date.now() });
    this.broadcastGameState();
  }

  reset(): void {
    this.clearSeatingTimer();
    this.state = this.initialState();
  }

  private clearSeatingTimer(): void {
    if (this.seatingTimer) {
      clearTimeout(this.seatingTimer);
      this.seatingTimer = null;
    }
    this.seatingActive = false;
  }

  handleChatMessage(msg: ChatMessage): void {
    const text = normalizeChatCommand(msg.message);

    if (/^!\s*دخول$/.test(text)) {
      // Legacy alias — same path as the global !انضم command.
      this.handleJoinCommand({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl, socketId: msg.socketId });
      return;
    }

    if (/^!\s*جلوس$/.test(text)) {
      this.handleSit(msg);
      return;
    }
  }

  /**
   * Global !انضم entry point. Consistent with Mafia: the first join while the
   * game is idle opens the lobby automatically; admin mc:start still works.
   */
  handleJoinCommand(identity: PlayerIdentity): void {
    if (this.state.phase === 'idle') {
      this.start();
    }

    if (this.state.phase === 'playing' || this.state.phase === 'finished') {
      this.broadcast({
        type: 'game:joinRejected',
        payload: {
          gameId: this.config.id,
          playerId: identity.authorId,
          displayName: identity.displayName,
          reason: this.state.phase === 'finished' ? 'gameFinished' : 'gameInProgress',
          message: this.state.phase === 'finished'
            ? 'انتهت الجولة الحالية — بانتظار إعادة تعيين اللعبة.'
            : 'الجولة بدأت بالفعل، انتظروا الجولة القادمة.',
        },
        timestamp: Date.now(),
      });
      return;
    }

    if (this.state.players.has(identity.authorId)) return;

    this.state.players.set(identity.authorId, {
      id: identity.authorId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      sat: false,
      eliminated: false,
      joinedAt: Date.now(),
    });

    this.broadcast({
      type: 'game:playerJoined',
      payload: {
        gameId: this.config.id,
        playerId: identity.authorId,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        playerCount: this.state.players.size,
      },
      timestamp: Date.now(),
    });
    this.broadcastGameState();
  }

  handleAdminCommand(command: string, _payload?: unknown): void {
    switch (command) {
      case 'mc:start':
        this.start();
        break;
      case 'mc:closeLobby':
        this.closeLobby();
        break;
      case 'mc:startSeating':
        this.openSeating();
        break;
      case 'mc:endSeating':
        this.endSeating();
        break;
      case 'mc:reset':
        this.reset();
        this.init();
        break;
    }
  }

  private handleSit(msg: ChatMessage): void {
    if (this.state.phase !== 'playing') return;

    const player = this.state.players.get(msg.authorId);
    if (!player) return;
    if (player.eliminated) return;
    if (player.sat) return;

    const seatedCount = this.countSeated();
    if (seatedCount >= this.state.chairsAvailable) return;

    player.sat = true;

    this.broadcast({
      type: 'mc:playerSat',
      payload: {
        playerId: msg.authorId,
        displayName: msg.author,
        seated: seatedCount + 1,
        chairsAvailable: this.state.chairsAvailable,
      },
      timestamp: Date.now(),
    });
    this.broadcastGameState();

    // All chairs taken: wrap up quickly (1s grace), replacing the long timer.
    if (seatedCount + 1 >= this.state.chairsAvailable) {
      this.scheduleSeatingEnd(1000);
    }
  }

  /** Arms the single seating-end timer; re-arming cancels any pending one. */
  private scheduleSeatingEnd(ms: number): void {
    if (this.seatingTimer) {
      clearTimeout(this.seatingTimer);
    }
    this.seatingTimer = setTimeout(() => {
      this.seatingTimer = null;
      this.endSeating();
    }, ms);
  }

  private closeLobby(): void {
    if (this.state.phase !== 'lobby') return;

    const alivePlayers = this.getAlivePlayers();
    if (alivePlayers.length < 2) {
      this.broadcast({
        type: 'mc:notEnoughPlayers',
        payload: { count: alivePlayers.length },
        timestamp: Date.now(),
      });
      return;
    }

    this.state.totalPlayersStart = alivePlayers.length;
    this.state.currentRound = 1;
    this.state.chairsAvailable = alivePlayers.length - 1;
    this.state.phase = 'playing';

    this.broadcast({
      type: 'mc:lobbyClosed',
      payload: {
        totalPlayers: alivePlayers.length,
        chairsAvailable: this.state.chairsAvailable,
        round: this.state.currentRound,
      },
      timestamp: Date.now(),
    });
    this.broadcastGameState();
  }

  private openSeating(): void {
    if (this.state.phase !== 'playing') return;

    for (const [, player] of this.state.players) {
      if (!player.eliminated) player.sat = false;
    }

    this.state.seatingStartTime = Date.now();
    this.seatingActive = true;

    this.broadcast({
      type: 'mc:musicStopped',
      payload: {
        chairsAvailable: this.state.chairsAvailable,
        seatingDuration: this.state.seatingDuration,
      },
      timestamp: Date.now(),
    });
    this.broadcastGameState();

    this.scheduleSeatingEnd(this.state.seatingDuration * 1000);
  }

  private endSeating(): void {
    if (!this.seatingActive || this.state.phase !== 'playing') return;
    // Re-entry guard: whichever trigger fires first cancels the other.
    this.clearSeatingTimer();

    const alivePlayers = this.getAlivePlayers();

    // Core rule: when the music stops, EVERYONE left standing is out —
    // regardless of whether every chair was taken (chairs are n-1 by design,
    // so an all-filled round still leaves exactly one player standing).
    const eliminated: { id: string; displayName: string }[] = [];
    for (const player of alivePlayers) {
      if (!player.sat) {
        player.eliminated = true;
        eliminated.push({ id: player.id, displayName: player.displayName });
      }
    }

    this.broadcast({
      type: 'mc:roundEnded',
      payload: {
        round: this.state.currentRound,
        seated: this.countSeated(),
        eliminated,
        remaining: this.getAlivePlayers().length,
      },
      timestamp: Date.now(),
    });

    const remaining = this.getAlivePlayers();

    if (remaining.length <= 1) {
      this.state.winner = remaining[0]?.id ?? null;
      this.state.phase = 'finished';
      this.broadcast({
        type: 'mc:gameOver',
        payload: {
          winner: remaining[0]?.displayName ?? null,
          winnerId: remaining[0]?.id ?? null,
        },
        timestamp: Date.now(),
      });
    } else {
      this.state.currentRound++;
      this.state.chairsAvailable = remaining.length - 1;
      for (const player of remaining) {
        player.sat = false;
      }
    }

    this.broadcastGameState();
  }

  private countSeated(): number {
    let count = 0;
    for (const [, player] of this.state.players) {
      if (!player.eliminated && player.sat) count++;
    }
    return count;
  }

  private getAlivePlayers(): MusicalChairsPlayer[] {
    const alive: MusicalChairsPlayer[] = [];
    for (const [, player] of this.state.players) {
      if (!player.eliminated) alive.push(player);
    }
    return alive;
  }

  getPublicState(): Record<string, unknown> {
    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      currentRound: this.state.currentRound,
      chairsAvailable: this.state.chairsAvailable,
      players: Array.from(this.state.players.values()).map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        sat: p.sat,
        eliminated: p.eliminated,
        joinedAt: p.joinedAt,
        // Phase 9E: public status derived from existing rules only.
        status: p.eliminated
          ? 'eliminated'
          : this.state.phase === 'finished' && this.state.winner === p.id
            ? 'winner'
            : 'playing',
      })),
      winner: this.state.winner,
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}
