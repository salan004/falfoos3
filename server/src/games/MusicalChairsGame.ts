import { BaseGame, GameConfig, ChatMessage, GamePhase } from '../core/BaseGame';

interface MusicalChairsPlayer {
  id: string;
  displayName: string;
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
    this.state.phase = 'idle';
    this.broadcast({ type: 'mc:stopped', payload: {}, timestamp: Date.now() });
    this.broadcastGameState();
  }

  reset(): void {
    this.state = this.initialState();
  }

  handleChatMessage(msg: ChatMessage): void {
    const text = msg.message.trim();

    if (text === '!دخول') {
      this.handleJoin(msg);
      return;
    }

    if (text === '!جلوس') {
      this.handleSit(msg);
      return;
    }
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

  private handleJoin(msg: ChatMessage): void {
    if (this.state.phase !== 'lobby') return;
    if (this.state.players.has(msg.authorId)) return;

    this.state.players.set(msg.authorId, {
      id: msg.authorId,
      displayName: msg.author,
      sat: false,
      eliminated: false,
      joinedAt: Date.now(),
    });

    this.broadcast({
      type: 'mc:playerJoined',
      payload: { playerId: msg.authorId, displayName: msg.author, playerCount: this.state.players.size },
      timestamp: Date.now(),
    });
    this.broadcastGameState();
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

    if (seatedCount + 1 >= this.state.chairsAvailable) {
      setTimeout(() => this.endSeating(), 1000);
    }
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

    this.broadcast({
      type: 'mc:musicStopped',
      payload: {
        chairsAvailable: this.state.chairsAvailable,
        seatingDuration: this.state.seatingDuration,
      },
      timestamp: Date.now(),
    });
    this.broadcastGameState();

    setTimeout(() => this.endSeating(), this.state.seatingDuration * 1000);
  }

  private endSeating(): void {
    if (this.state.phase !== 'playing') return;

    const seatedCount = this.countSeated();
    const alivePlayers = this.getAlivePlayers();

    const eliminated: { id: string; displayName: string }[] = [];

    if (seatedCount < this.state.chairsAvailable) {
      for (const player of alivePlayers) {
        if (!player.sat && !player.eliminated) {
          player.eliminated = true;
          eliminated.push({ id: player.id, displayName: player.displayName });
        }
      }
    }

    this.broadcast({
      type: 'mc:roundEnded',
      payload: {
        round: this.state.currentRound,
        seated: seatedCount,
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

  private broadcastGameState(): void {
    this.broadcast({
      type: 'game:state',
      payload: {
        gameId: this.config.id,
        phase: this.state.phase,
        currentRound: this.state.currentRound,
        chairsAvailable: this.state.chairsAvailable,
        players: Array.from(this.state.players.values()).map((p) => ({
          id: p.id,
          displayName: p.displayName,
          sat: p.sat,
          eliminated: p.eliminated,
          joinedAt: p.joinedAt,
        })),
        winner: this.state.winner,
      },
      timestamp: Date.now(),
    });
  }
}
