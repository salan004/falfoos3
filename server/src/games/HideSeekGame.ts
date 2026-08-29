import { BaseGame, GameConfig, ChatMessage, GamePhase, PlayerIdentity } from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';

const ZONES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4'];

interface HideSeekPlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  zone: string | null;
  isCaught: boolean;
}

export class HideSeekGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'hide_and_seek',
    name: 'الغميضة',
    description: 'اختبئ في منطقة عبر !hide A1 — المضيف يفتّش المناطق ومن يُكتشف يُقصى!',
    minPlayers: 1,
  };

  state: { phase: GamePhase; players: HideSeekPlayer[]; searchedZones: string[] } = {
    phase: 'idle',
    players: [],
    searchedZones: [],
  };

  init(): void { this.newSessionId(); this.reset(); this.broadcastGameState(); }
  start(): void { this.state.phase = 'lobby'; this.broadcastGameState(); }
  stop(): void { this.state.phase = 'idle'; this.broadcastGameState(); }
  reset(): void {
    this.state = { phase: 'idle', players: [], searchedZones: [] };
  }

  handleChatMessage(msg: ChatMessage): void {
    // NOTE: !join / !انضم are handled globally by GameManager -> handleJoinCommand.
    const hideMatch = normalizeChatCommand(msg.message).match(/^!\s*(?:hide|اختبئ)\s+([A-D][1-4])/i);
    if (hideMatch && this.state.phase === 'lobby') {
      const player = this.state.players.find((p) => p.id === msg.authorId);
      if (player) {
        player.zone = hideMatch[1].toUpperCase();
        this.broadcast({ type: 'hs:playerHidden', payload: { playerId: msg.authorId, zone: player.zone }, timestamp: Date.now() });
        this.broadcastGameState();
      } else {
        // Never silently ignore a viewer who tries to hide before joining.
        this.broadcast({
          type: 'game:joinRejected',
          payload: {
            gameId: this.config.id,
            playerId: msg.authorId,
            displayName: msg.author,
            reason: 'notJoined',
            message: 'انضم أولاً عبر أمر !انضم ثم اختبئ عبر !hide A1 أو !اختبئ A1.',
          },
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Global !انضم entry point. Consistent with the other lobby games: joining
   * while idle opens the lobby automatically; admin hs:startHiding still works.
   */
  handleJoinCommand(identity: PlayerIdentity): void {
    if (this.state.phase === 'idle') {
      this.start();
    }

    if (this.state.phase !== 'lobby') {
      this.broadcast({
        type: 'game:joinRejected',
        payload: {
          gameId: this.config.id,
          playerId: identity.authorId,
          displayName: identity.displayName,
          reason: 'notAcceptingPlayers',
          message: 'اللعبة لا تقبل انضماماً الآن.',
        },
        timestamp: Date.now(),
      });
      return;
    }

    if (this.tryRegisterPlayer(this.state.players, identity, () => ({
      id: identity.authorId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
      zone: null,
      isCaught: false,
    })) === 'added') {
      this.broadcast({
        type: 'game:playerJoined',
        payload: {
          gameId: this.config.id,
          playerId: identity.authorId,
          displayName: identity.displayName,
          avatarUrl: identity.avatarUrl,
          playerCount: this.state.players.length,
        },
        timestamp: Date.now(),
      });
      this.broadcastGameState();
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
      // Dedupe: re-searching a zone adds no information.
      if (!this.state.searchedZones.includes(zone)) {
        this.state.searchedZones.push(zone);
      }
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

  getPublicState(): Record<string, unknown> {
    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      players: this.state.players.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        zone: p.zone,
        isCaught: p.isCaught,
        // Phase 9E: hiding/found exist in the current rules. No winner or
        // elimination rule exists yet — none was invented in this phase.
        status: p.isCaught ? 'found' : 'hiding',
      })),
      searchedZones: [...this.state.searchedZones],
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}
