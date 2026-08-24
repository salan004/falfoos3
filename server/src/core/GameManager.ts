import { BaseGame, ChatMessage, GameEvent, GameSettingsSchema } from './BaseGame';
import { normalizeChatCommand, isJoinCommand } from './chatCommands';
import { Server as SocketIOServer } from 'socket.io';
import {
  completeMatch,
  ensureGuestRow,
  recordMatchStart,
  recordMatchWinners,
  recordParticipation,
  recordScoreEvent,
} from '../db/history';
import type { WinnerScope } from './BaseGame';
import { evaluateAchievements } from '../achievements/catalog';

interface LeaderboardEntry {
  playerId: string;
  displayName: string;
  score: number;
  /** Phase 9G foundation fields — additive, optional, backwards compatible. */
  avatarUrl?: string;
  gameId?: string;
  sessionId?: string;
  /** Phase 11D — present only when the guest identity has been claimed by a registered user. */
  userId?: string;
}

export class GameManager {
  private games: Map<string, BaseGame> = new Map();
  private activeGameId: string | null = null;
  private io: SocketIOServer | null = null;
  private scores: Map<string, number> = new Map();
  private playerNames: Map<string, string> = new Map();
  private playerAvatars: Map<string, string> = new Map();
  /**
   * Phase 11D — optional read-side resolver (wired in index.ts to a prepared
   * statement over guests.claimed_user_id). Pure enrichment: scoring, ranking
   * and ordering are untouched.
   */
  private claimResolver: ((playerId: string) => string | undefined) | null = null;
  /**
   * Phase 11G — the active activation's history row id (=== sessionId).
   * Runtime scoring stays authoritative; SQLite is additive write-through.
   */
  private currentMatchId: string | null = null;

  setSocketServer(io: SocketIOServer): void {
    this.io = io;
  }

  setClaimResolver(resolver: (playerId: string) => string | undefined): void {
    this.claimResolver = resolver;
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

  getRegisteredGames(): { id: string; name: string; description: string; settingsSchema: GameSettingsSchema }[] {
    const result: { id: string; name: string; description: string; settingsSchema: GameSettingsSchema }[] = [];
    this.games.forEach((game) => {
      result.push({
        id: game.config.id,
        name: game.config.name,
        description: game.config.description,
        settingsSchema: game.getSettingsSchema(),
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
      // Phase 11G — the replaced activation's match is completed (once).
      // Incomplete matches from crashes keep ended_at NULL by design.
      if (this.currentMatchId) {
        try {
          completeMatch(this.currentMatchId);
        } catch (err) {
          console.warn('[GameManager] History: failed to complete match:', err instanceof Error ? err.message : err);
        }
        this.currentMatchId = null;
      }
    }

    this.activeGameId = gameId;
    const game = this.games.get(gameId)!;
    game.init();

    // Phase 11G — start the history row for the fresh activation.
    const sessionId = game.getSessionId();
    try {
      recordMatchStart(sessionId, gameId);
      this.currentMatchId = sessionId;
    } catch (err) {
      console.warn('[GameManager] History: failed to record match start:', err instanceof Error ? err.message : err);
    }

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

  /**
   * Single entry point for every chat message (YouTube Live Chat or local).
   *
   * The GLOBAL !انضم command is detected ONCE here and routed to the active
   * game's handleJoinCommand — games never re-implement join parsing.
   * All other messages flow to the game's own handler.
   */
  dispatchChat(msg: ChatMessage): void {
    const game = this.getActiveGame();
    const normalized = normalizeChatCommand(msg.message);

    if (isJoinCommand(normalized)) {
      if (game) {
        if (game.handleJoinCommand) {
          game.handleJoinCommand({
            authorId: msg.authorId,
            displayName: msg.author,
            avatarUrl: msg.authorImageUrl,
            socketId: msg.socketId,
          });
        } else {
          this.broadcast({
            type: 'game:joinRejected',
            payload: {
              gameId: game.config.id,
              playerId: msg.authorId,
              displayName: msg.author,
              reason: 'joinNotSupported',
              message: 'هذه اللعبة لا تحتاج انضماماً — شارك مباشرة عبر الدردشة.',
            },
            timestamp: Date.now(),
          });
        }
      } else {
        this.broadcast({
          type: 'game:joinRejected',
          payload: {
            playerId: msg.authorId,
            displayName: msg.author,
            reason: 'noActiveGame',
            message: 'لا توجد لعبة نشطة حالياً — فعّل لعبة من صفحة الألعاب أولاً.',
          },
          timestamp: Date.now(),
        });
      }
    } else if (game) {
      game.handleChatMessage(msg);
    }

    this.broadcast({
      type: 'chat:message',
      payload: {
        author: msg.author,
        authorId: msg.authorId,
        authorImageUrl: msg.authorImageUrl,
        isModerator: msg.isModerator,
        message: msg.message,
      },
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

  /**
   * Phase 9G: avatarUrl is optional so every existing 3-arg caller keeps
   * compiling. Entries are enriched with the active game's id/sessionId at
   * score time — no scoring rules are changed here. `reason` (Phase 12A) is
   * an optional free-form code persisted with the score event.
   */
  updateScore(
    playerId: string,
    displayName: string,
    delta: number,
    avatarUrl?: string,
    reason?: string
  ): void {
    const current = this.scores.get(playerId) ?? 0;
    this.scores.set(playerId, current + delta);
    this.playerNames.set(playerId, displayName);
    if (avatarUrl) {
      this.playerAvatars.set(playerId, avatarUrl);
    }

    // Phase 11G — additive history write-through (reason intentionally NULL
    // for now). Failures never touch gameplay; the runtime map is truth.
    if (this.currentMatchId) {
      try {
        ensureGuestRow(playerId, displayName, avatarUrl);
        recordScoreEvent(this.currentMatchId, playerId, delta, reason);
      } catch (err) {
        console.warn('[GameManager] History: failed to record score event:', err instanceof Error ? err.message : err);
      }
    }

    this.broadcastLeaderboard();
  }

  getLeaderboard(): LeaderboardEntry[] {
    const activeGame = this.getActiveGame();
    const gameId = this.activeGameId ?? undefined;
    const sessionId = activeGame?.getSessionId() || undefined;
    const entries: LeaderboardEntry[] = [];
    this.scores.forEach((score, playerId) => {
      const userId = this.claimResolver?.(playerId);
      entries.push({
        playerId,
        displayName: this.playerNames.get(playerId) ?? playerId,
        score,
        avatarUrl: this.playerAvatars.get(playerId),
        gameId,
        sessionId,
        ...(userId ? { userId } : {}),
      });
    });
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }

  resetScores(): void {
    this.scores.clear();
    this.playerNames.clear();
    this.playerAvatars.clear();
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
    // Phase 11G — observe join acceptances for participation history.
    // Games emit this ONLY when a player was actually added (built-in dedupe),
    // and the participations PK makes reconnects idempotent regardless.
    if (event.type === 'game:playerJoined') {
      this.observePlayerJoined(event.payload);
    }
    // Phase 12A — observe the standardized result contract (BaseGame.
    // announceWinners). Winners are persisted additively; a match-scope
    // finish also stamps ended_at (natural completion, not just switch/
    // shutdown). Persistence failures never reach gameplay.
    if (event.type === 'game:finished') {
      this.observeGameFinished(event.payload);
    }
    if (!this.io) return;
    this.io.emit('game:event', event);
  }

  private observePlayerJoined(payload: unknown): void {
    const p = payload as { gameId?: string; playerId?: string; displayName?: string; avatarUrl?: string };
    if (!this.currentMatchId || !p?.playerId) return;
    try {
      ensureGuestRow(p.playerId, p.displayName, p.avatarUrl);
      recordParticipation(this.currentMatchId, p.playerId);
    } catch (err) {
      console.warn('[GameManager] History: failed to record participation:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Phase 12A — persists `game:finished` results against the CURRENT match
   * row. scope='match' additionally stamps ended_at once (completeMatch is
   * guarded by ended_at IS NULL, so a later switch/shutdown close is a no-op).
   *
   * currentMatchId is intentionally NOT cleared: games may keep emitting
   * within the same activation (and self-reset via init() is a known Phase
   * 11G quirk — switchGame remains the authoritative match boundary).
   */
  private observeGameFinished(payload: unknown): void {
    if (!this.currentMatchId) return;
    const p = payload as { winnerIds?: unknown; scope?: unknown };
    const winnerIds = Array.isArray(p?.winnerIds)
      ? p.winnerIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    if (winnerIds.length === 0) return;
    const scope: WinnerScope = p?.scope === 'match' ? 'match' : 'round';

    try {
      const inserted = recordMatchWinners(this.currentMatchId, winnerIds, scope);
      console.log(`[GameManager] History: ${inserted} ${scope} winner(s) recorded for match ${this.currentMatchId}`);
      if (scope === 'match') {
        completeMatch(this.currentMatchId);
      }
      // Phase 12D — achievements are evaluated ONLY here (event-driven, off
      // the scoring hot path). Failures never reach gameplay.
      for (const winnerId of winnerIds) {
        try {
          const awarded = evaluateAchievements(winnerId);
          if (awarded.length > 0) {
            console.log(`[GameManager] Achievements awarded to ${winnerId}: ${awarded.join(', ')}`);
          }
        } catch (err) {
          console.warn('[GameManager] Achievements: evaluation failed:', err instanceof Error ? err.message : err);
        }
      }
    } catch (err) {
      console.warn('[GameManager] History: failed to record match result:', err instanceof Error ? err.message : err);
    }
  }

  /** Phase 11G — graceful shutdown hook: closes the open match (best-effort). */
  endCurrentMatch(): void {
    if (!this.currentMatchId) return;
    try {
      completeMatch(this.currentMatchId);
    } catch (err) {
      console.warn('[GameManager] History: shutdown completion failed:', err instanceof Error ? err.message : err);
    }
    this.currentMatchId = null;
  }
}
