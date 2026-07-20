import { BaseGame, ChatMessage, GameEvent } from './BaseGame';
import { Server as SocketIOServer } from 'socket.io';

interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  score: number;
}

export class GameManager {
  private games: Map<string, BaseGame> = new Map();
  private activeGameId: string | null = null;
  private io: SocketIOServer | null = null;
  private scores: Map<string, number> = new Map();
  private playerNames: Map<string, string> = new Map();

  setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  registerGame(game: BaseGame): void {
    const id = game.config.id;
    if (this.games.has(id)) {
      throw new Error(`Game "${id}" is already registered`);
    }
    game.setBroadcast((event: GameEvent) => this.broadcast(event));
    this.games.set(id, game);
    console.log(`[GameManager] Registered game: ${id}`);
  }

  getRegisteredGames(): { id: string; name: string; description: string }[] {
    const result: { id: string; name: string; description: string }[] = [];
    this.games.forEach((game) => {
      result.push({
        id: game.config.id,
        name: game.config.name,
        description: game.config.description,
      });
    });
    return result;
  }

  switchGame(gameId: string): boolean {
    if (!this.games.has(gameId)) {
      console.error(`[GameManager] Game "${gameId}" not found`);
      return false;
    }

    if (this.activeGameId) {
      const current = this.games.get(this.activeGameId);
      current?.stop();
    }

    this.activeGameId = gameId;
    const game = this.games.get(gameId)!;
    game.init();
    console.log(`[GameManager] Switched to game: ${gameId}`);
    this.broadcast({
      type: 'game:switched',
      payload: { gameId, config: game.config },
      timestamp: Date.now(),
    });
    return true;
  }

  startActiveGame(): boolean {
    const game = this.getActiveGame();
    if (!game) return false;
    game.start();
    return true;
  }

  stopActiveGame(): boolean {
    const game = this.getActiveGame();
    if (!game) return false;
    game.stop();
    return true;
  }

  getActiveGame(): BaseGame | null {
    if (!this.activeGameId) return null;
    return this.games.get(this.activeGameId) ?? null;
  }

  getActiveGameId(): string | null {
    return this.activeGameId;
  }

  dispatchChat(msg: ChatMessage): void {
    const game = this.getActiveGame();
    if (game) {
      game.handleChatMessage(msg);
    }
    this.broadcast({
      type: 'chat:message',
      payload: { author: msg.author, authorId: msg.authorId, message: msg.message },
      timestamp: Date.now(),
    });
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    if (command === 'switchGame') {
      this.switchGame(payload as string);
      return;
    }
    if (command === 'startGame') {
      this.startActiveGame();
      return;
    }
    if (command === 'stopGame') {
      this.stopActiveGame();
      return;
    }
    const game = this.getActiveGame();
    if (game) {
      game.handleAdminCommand(command, payload);
    }
  }

  updateScore(playerId: string, displayName: string, delta: number): void {
    const current = this.scores.get(playerId) ?? 0;
    this.scores.set(playerId, current + delta);
    this.playerNames.set(playerId, displayName);
    this.broadcastLeaderboard();
  }

  getLeaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    this.scores.forEach((score, playerId) => {
      entries.push({
        playerId,
        displayName: this.playerNames.get(playerId) ?? playerId,
        score,
      });
    });
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }

  resetScores(): void {
    this.scores.clear();
    this.playerNames.clear();
    this.broadcastLeaderboard();
  }

  private broadcastLeaderboard(): void {
    this.broadcast({
      type: 'leaderboard:update',
      payload: { entries: this.getLeaderboard() },
      timestamp: Date.now(),
    });
  }

  private broadcast(event: GameEvent): void {
    if (!this.io) return;
    this.io.emit('game:event', event);
  }
}
