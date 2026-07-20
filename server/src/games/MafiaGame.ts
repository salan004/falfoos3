import { BaseGame, GameConfig, ChatMessage, GamePhase } from '../core/BaseGame';

export class MafiaGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'mafia',
    name: 'Mafia',
    description: 'Join via !join. Secret roles assigned. Vote to eliminate suspects during the day phase.',
    minPlayers: 4,
  };

  state: { phase: GamePhase; players: { id: string; displayName: string; role: string; isAlive: boolean }[]; nightPhase: boolean; eliminatedToday: string | null } = {
    phase: 'idle',
    players: [],
    nightPhase: false,
    eliminatedToday: null,
  };

  init(): void { this.reset(); this.broadcastGameState(); }
  start(): void { this.state.phase = 'lobby'; this.broadcastGameState(); }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', players: [], nightPhase: false, eliminatedToday: null };
  }

  handleChatMessage(msg: ChatMessage): void {
    const text = msg.message.trim().toLowerCase();
    if (text === '!join' && this.state.phase === 'lobby') {
      if (!this.state.players.find((p) => p.id === msg.authorId)) {
        this.state.players.push({ id: msg.authorId, displayName: msg.author, role: 'villager', isAlive: true });
        this.broadcastGameState();
      }
    }
  }

  handleAdminCommand(command: string, _payload?: unknown): void {
    if (command === 'mafia:assignRoles') {
      this.assignRoles();
    }
  }

  private assignRoles(): void {
    const count = this.state.players.length;
    if (count < 4) return;
    const roles = ['mafia', 'mafia', 'detective', 'doctor'];
    while (roles.length < count) roles.push('villager');
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    this.state.players.forEach((p, i) => { p.role = roles[i]; });
    this.broadcast({ type: 'mafia:rolesAssigned', payload: {}, timestamp: Date.now() });
    this.broadcastGameState();
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: { gameId: this.config.id, ...this.state }, timestamp: Date.now() });
  }
}
