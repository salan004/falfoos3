import { BaseGame, GameConfig, ChatMessage, GamePhase } from '../core/BaseGame';

const ZONES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4'];

export class HideSeekGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'hide_and_seek',
    name: 'Hide and Seek',
    description: 'Hide in a zone with !hide A1. The host searches zones — caught players are out!',
    minPlayers: 1,
  };

  state: { phase: GamePhase; players: { id: string; displayName: string; zone: string | null; isCaught: boolean }[]; searchedZones: string[] } = {
    phase: 'idle',
    players: [],
    searchedZones: [],
  };

  init(): void { this.reset(); this.broadcastGameState(); }
  start(): void { this.state.phase = 'lobby'; this.broadcastGameState(); }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', players: [], searchedZones: [] };
  }

  handleChatMessage(msg: ChatMessage): void {
    const text = msg.message.trim().toLowerCase();
    if (text === '!join' && this.state.phase === 'lobby') {
      if (!this.state.players.find((p) => p.id === msg.authorId)) {
        this.state.players.push({ id: msg.authorId, displayName: msg.author, zone: null, isCaught: false });
        this.broadcastGameState();
      }
      return;
    }
    const hideMatch = msg.message.match(/^!hide\s+([A-D][1-4])/i);
    if (hideMatch && this.state.phase === 'lobby') {
      const player = this.state.players.find((p) => p.id === msg.authorId);
      if (player) {
        player.zone = hideMatch[1].toUpperCase();
        this.broadcast({ type: 'hs:playerHidden', payload: { playerId: msg.authorId, zone: player.zone }, timestamp: Date.now() });
        this.broadcastGameState();
      }
    }
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    if (command === 'hs:startHiding') {
      this.state.phase = 'lobby';
      this.broadcastGameState();
    }
    if (command === 'hs:searchZone' && typeof payload === 'string') {
      const zone = payload.toUpperCase();
      if (!ZONES.includes(zone)) return;
      this.state.searchedZones.push(zone);
      const caught = this.state.players.filter((p) => p.zone === zone && !p.isCaught);
      for (const p of caught) p.isCaught = true;
      this.broadcast({
        type: 'hs:zoneSearched',
        payload: { zone, caught: caught.map((p) => p.displayName) },
        timestamp: Date.now(),
      });
      this.broadcastGameState();
    }
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: { gameId: this.config.id, ...this.state }, timestamp: Date.now() });
  }
}
