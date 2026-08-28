import "dotenv/config";
import express from 'express';
import http from 'http';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { GameManager } from './core/GameManager';
import { YouTubeChatService, isQuotaErrorMessage, type YouTubeHealthSnapshot } from './core/YouTubeChatService';
import { env, validateStartupConfig } from './config/env';
import { initDatabase } from './db/db';
import { getDb } from './db/db';
import { countIncompleteMatches } from './db/history';
import { getGlobalLeaderboard } from './db/stats';
import { authRoutes } from './routes/authRoutes';
import { guestRoutes } from './routes/guestRoutes';
import { playerRoutes } from './routes/playerRoutes';
import { setCurrentChatService } from './auth/claiming';
import {
  attachSocketIdentity,
  authoritativeAuthorId,
  type SocketIdentity,
} from './auth/socketIdentity';
import { TriviaGame } from './games/TriviaGame';
import { MusicalChairsGame } from './games/MusicalChairsGame';
import { MafiaGame } from './games/MafiaGame';
import { GuessingGame } from './games/GuessingGame';
import { DrawingGame } from './games/DrawingGame';
import { HideSeekGame } from './games/HideSeekGame';

const PORT = env.PORT ? parseInt(env.PORT) : 4000;
/** Live-chat polling cadence. 8000ms ≈ 60% better YouTube quota life than 5s. */
const YOUTUBE_POLL_MS = env.YOUTUBE_POLL_MS ? Math.max(2000, parseInt(env.YOUTUBE_POLL_MS, 10)) : 8000;

// ---------------------------------------------------------------------------
// Admin authorization (Phase 9A). The token NEVER reaches client-side code:
// admins submit it at runtime via the `admin:auth` socket handshake, and only
// that connection is flagged as admin. When ADMIN_TOKEN is not configured an
// ephemeral token is generated per boot and printed to the server console so
// local development stays usable while the default remains deny-by-default.
// ---------------------------------------------------------------------------
const ADMIN_TOKEN = env.ADMIN_TOKEN ?? randomUUID();

function isSocketAdmin(socket: Socket): boolean {
  // Phase 9A break-glass token handshake stays the primary path.
  if (socket.data?.isAdmin === true) return true;
  // Phase 11E dual-path: registered users with the admin role qualify too.
  const identity = socket.data?.identity as SocketIdentity | undefined;
  return identity?.role === 'admin';
}

/**
 * Phase A — broadcast connection permission.
 * Admins always qualify. Authenticated users (kind === 'user') can connect/disconnect
 * the YouTube broadcast. Guests (kind === 'guest') cannot.
 */
function isBroadcaster(socket: Socket): boolean {
  if (isSocketAdmin(socket)) return true;
  const identity = socket.data?.identity as SocketIdentity | undefined;
  return identity?.kind === 'user';
}

function rejectUnauthorized(socket: Socket, action: string): void {
  console.warn(`[Falfoos] Unauthorized admin attempt (${action}) from socket ${socket.id} — rejected`);
  socket.emit('admin:error', { message: 'غير مصرح — سجّل الدخول كمشرف أولاً.', action });
}

// ---------------------------------------------------------------------------
// Phase 11B: open + migrate the SQLite database once at boot. Pure foundation
// — no behavior depends on it yet (auth arrives in 11C, persistence in 11G).
// ---------------------------------------------------------------------------
const dbInfo = initDatabase();
console.log(`[Falfoos] Database ready (${dbInfo.dbPath}) migrations=${dbInfo.totalMigrations}`);
// Phase 19 — startup configuration report (names/statuses only, never values).
validateStartupConfig();
// Phase 11G — crashed/interrupted activations stay honestly incomplete (NULL
// ended_at); they are never fabricated into completions.
const incompleteMatches = countIncompleteMatches();
if (incompleteMatches > 0) {
  console.log(`[Falfoos] History: ${incompleteMatches} incomplete match(es) preserved from previous runs`);
}

// ---------------------------------------------------------------------------
// Global error visibility. Node >=15 terminates on unhandled rejections by
// default — these handlers make every failure diagnosable instead of silent.
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason) => {
  // Resilient policy: log loudly, keep serving the live stream.
  console.error('[Falfoos] Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Falfoos] Uncaught exception — shutting down:', err);
  process.exit(1);
});

const app = express();
app.use(cors({
  origin: 'https://falfoos.vercel.app',
  credentials: true,
}));
app.use(express.json());

// Phase 11C: optional Google authentication. Fully additive — guests never
// touch these routes, and nothing existing requires a session.
app.use('/api/auth', authRoutes);

// Phase 11D: stable anonymous guest identity (httpOnly cookie, server-issued).
app.use('/api/guest', guestRoutes);

// Phase 12B: player profiles & stats (public read-only + /me resolution).
app.use('/api', playerRoutes);

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: 'https://falfoos.vercel.app', credentials: true, methods: ['GET', 'POST'] },
});

// ---------------------------------------------------------------------------
// Phase 11E — server-authoritative socket identity. Every handshake is
// resolved from HTTP cookies (falfoos_session / falfoos_guest); connections
// with neither are rejected and the client self-recovers via the guest
// identity endpoint. The client can never choose its canonical player id.
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  try {
    attachSocketIdentity(socket);
    if (!socket.data.identity) {
      next(new Error('identity-required'));
      return;
    }
    const identity = socket.data.identity as SocketIdentity;
    console.log(
      `[Falfoos] Socket identity resolved (${identity.kind}${identity.role === 'admin' ? '/admin' : ''}): ${identity.canonicalPlayerId}`
    );
    next();
  } catch (err) {
    next(err instanceof Error ? err : new Error('identity-resolution-failed'));
  }
});

const gameManager = new GameManager();
gameManager.setSocketServer(io);

// Phase 11D — leaderboard enrichment: entries gain an optional `userId` when
// the guest identity has been claimed by a registered user (Option A:
// claimed history counts for the user immediately, query-time only).
{
  const claimedStmt = getDb().prepare('SELECT claimed_user_id FROM guests WHERE player_id = ?');
  gameManager.setClaimResolver((playerId) => {
    const row = claimedStmt.get(playerId) as { claimed_user_id: string | null } | undefined;
    return row?.claimed_user_id ?? undefined;
  });
}

const triviaGame = new TriviaGame(gameManager);
const musicalChairsGame = new MusicalChairsGame();
const mafiaGame = new MafiaGame(gameManager, io);
const guessingGame = new GuessingGame(gameManager);
const drawingGame = new DrawingGame(gameManager);
const hideSeekGame = new HideSeekGame();

gameManager.registerGame(triviaGame);
gameManager.registerGame(musicalChairsGame);
gameManager.registerGame(mafiaGame);
gameManager.registerGame(guessingGame);
gameManager.registerGame(drawingGame);
gameManager.registerGame(hideSeekGame);

gameManager.switchGame('trivia');

const youtubeApiKey = env.YOUTUBE_API_KEY;

let youtubeChatService: YouTubeChatService | null = null;

/**
 * Generation counter guarding the async connect lifecycle.
 * Any disconnect (or newer connect) invalidates an in-flight connect attempt,
 * so a late verification result can never resurrect a closed connection and
 * leave the UI falsely "connected".
 */
let connectGeneration = 0;

/** Repeated poll failures before we declare the connection dead. */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

interface YouTubeStatusPayload {
  connected: boolean;
  videoId?: string;
  error?: string;
  /** Why the status changed: manual disconnect, poll-failure auto-drop, or failed connect. */
  reason?: 'manual' | 'pollFailure' | 'connectFailed' | 'reconnectFailed';
  /** Phase 14 — present while the supervisor is retrying a dropped connection. */
  reconnecting?: boolean;
  attempt?: number;
  maxAttempts?: number;
  health?: YouTubeHealthSnapshot;
}

// Phase 14 — automatic reconnection: exponential backoff after an unplanned
// poll-failure drop. Manual connect/disconnect and quota exhaustion cancel it.
const RECONNECT_DELAYS_MS = [3000, 6000, 12000, 24000, 48000];
let reconnectTimer: NodeJS.Timeout | null = null;
let reconnectAttempt = 0;
let reconnectVideoId: string | null = null;

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectVideoId = null;
  reconnectAttempt = 0;
}

function scheduleReconnect(): void {
  if (!reconnectVideoId) return;
  if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
    reconnectVideoId = null;
    broadcastYouTubeStatus('تعذّرت إعادة الاتصال تلقائيًا بعد عدة محاولات — أعد التشغيل يدويًا.', 'reconnectFailed');
    return;
  }
  const delay = RECONNECT_DELAYS_MS[reconnectAttempt];
  reconnectAttempt++;
  // Inform every tab that a supervised retry is pending (attempt N of M).
  broadcastYouTubeStatus();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    const vid = reconnectVideoId;
    if (!vid) return;
    void connectYouTube(vid, undefined, true);
  }, delay);
}

function buildYouTubeStatus(error?: string, reason?: YouTubeStatusPayload['reason']): YouTubeStatusPayload {
  const reconnecting = reconnectTimer !== null || reconnectAttempt > 0;
  return {
    connected: youtubeChatService?.isConnected() ?? false,
    videoId: youtubeChatService?.getVideoId() ?? undefined,
    error,
    reason,
    reconnecting,
    attempt: reconnecting ? reconnectAttempt : undefined,
    maxAttempts: RECONNECT_DELAYS_MS.length,
    health: youtubeChatService?.getHealth(),
  };
}

/** Real connection state is broadcast to ALL clients so every open tab stays in sync. */
function broadcastYouTubeStatus(error?: string, reason?: YouTubeStatusPayload['reason']): void {
  io.emit('youtube:status', buildYouTubeStatus(error, reason));
}

function sendYouTubeStatus(socketId: string, error?: string, reason?: YouTubeStatusPayload['reason']): void {
  io.to(socketId).emit('youtube:status', buildYouTubeStatus(error, reason));
}

function disconnectYouTube(): void {
  connectGeneration++;
  if (youtubeChatService) {
    try {
      youtubeChatService.disconnect();
    } catch (err) {
      console.error('[YouTubeChat] Error during disconnect:', err);
    }
    youtubeChatService = null;
  }
  setCurrentChatService(null);
}

async function connectYouTube(videoId: string, socketId?: string, keepReconnect = false): Promise<void> {
  if (!youtubeApiKey) {
    cancelReconnect();
    const error = 'YouTube API key not configured on server';
    if (socketId) sendYouTubeStatus(socketId, error, 'connectFailed');
    else broadcastYouTubeStatus(error, 'connectFailed');
    return;
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    cancelReconnect();
    const error = 'Invalid video ID';
    if (socketId) sendYouTubeStatus(socketId, error, 'connectFailed');
    else broadcastYouTubeStatus(error, 'connectFailed');
    return;
  }

  // A supervised reconnect keeps its bookkeeping alive across this call so a
  // failed retry can schedule the next backoff step.
  if (!keepReconnect) cancelReconnect();
  disconnectYouTube();
  const generation = ++connectGeneration;

  const service = new YouTubeChatService(
    (msg) => {
      gameManager.dispatchChat(msg);
    },
    YOUTUBE_POLL_MS,
    (_err, consecutiveFailures) => {
      if (
        consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES &&
        youtubeChatService === service
      ) {
        // Capture health BEFORE teardown so the quota decision is accurate.
        const health = youtubeChatService?.getHealth();
        const failedVideoId = youtubeChatService?.getVideoId() ?? null;
        disconnectYouTube();
        console.log('[YouTubeChat] Connection dropped after repeated poll failures');
        if (health?.quotaExceeded || (health?.lastErrorMessage && isQuotaErrorMessage(health.lastErrorMessage))) {          // Retrying while the daily quota is exhausted only burns more units.
          broadcastYouTubeStatus(
            'تم تجاوز حصة YouTube API اليومية — أعد المحاولة بعد تجدد الحصة.',
            'pollFailure'
          );
          return;
        }
        if (failedVideoId) {
          reconnectVideoId = failedVideoId;
          scheduleReconnect();
        } else {
          broadcastYouTubeStatus('Lost connection to the YouTube live chat', 'pollFailure');
        }
      }
    }
  );

  try {
    // Verifies an active live chat exists BEFORE we ever report success.
    await service.connect(videoId, youtubeApiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to connect to YouTube';
    console.error('[YouTubeChat] Connect failed:', message);
    // A disconnect/newer connect superseded this attempt ? stay silent.
    if (generation !== connectGeneration) return;
    // Supervised retry: a failed RE-connect attempt schedules the next backoff
    // step instead of giving up. First-time manual connects fail immediately.
    if (keepReconnect && reconnectVideoId) {
      scheduleReconnect();
      return;
    }
    cancelReconnect();
    broadcastYouTubeStatus(message, 'connectFailed');
    return;
  }

  // Superseded while verifying: discard the result, never report success.
  if (generation !== connectGeneration) {
    try { service.disconnect(); } catch { /* already stopped */ }
    console.log('[YouTubeChat] Discarded stale connect attempt (superseded)');
    return;
  }

  cancelReconnect();
  youtubeChatService = service;
  setCurrentChatService(service);
  broadcastYouTubeStatus();
}

function shutdown(): void {
  cancelReconnect();
  if (youtubeChatService) {
    youtubeChatService.disconnect();
    console.log('[YouTubeChat] Disconnected on shutdown');
  }
  // Phase 11G — close the open match on clean shutdown (best-effort).
  gameManager.endCurrentMatch();
  console.log('[Falfoos] Server shutting down');
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.emit('game:list', { games: gameManager.getRegisteredGames() });
  socket.emit('game:active', { gameId: gameManager.getActiveGameId() });

  const activeGame = gameManager.getActiveGame();
  if (activeGame) {
    // Every game implements getPublicState() — only curated public state is
    // ever sent to clients (no internal Maps, timers, or secret answers).
    socket.emit('game:state', {
      type: 'game:state',
      payload: activeGame.getPublicState(),
      timestamp: Date.now(),
    });
  }

  sendYouTubeStatus(socket.id);

  socket.on('get:games', () => {
    socket.emit('game:list', { games: gameManager.getRegisteredGames() });
    socket.emit('game:active', { gameId: gameManager.getActiveGameId() });
  });

  // Phase 9A: per-connection admin handshake. The token is submitted at
  // runtime (never shipped with the client bundle) and only THIS socket gets
  // flagged; reconnects must re-authenticate.
  socket.on('admin:auth', (data: { token?: unknown }) => {
    const supplied = typeof data?.token === 'string' ? data.token : '';
    if (supplied.length > 0 && supplied === ADMIN_TOKEN) {
      socket.data.isAdmin = true;
      console.log(`[Falfoos] Socket authorized as admin: ${socket.id}`);
      socket.emit('admin:authResult', { ok: true });
    } else {
      console.warn(`[Falfoos] Failed admin auth from socket ${socket.id}`);
      socket.emit('admin:authResult', { ok: false });
    }
  });

  socket.on('admin:command', (data: { command: string; payload?: unknown }) => {
    if (!isSocketAdmin(socket)) {
      rejectUnauthorized(socket, `admin:command:${data?.command ?? 'unknown'}`);
      return;
    }
    console.log(`[Socket] Admin command: ${data.command}`, data.payload);
    gameManager.handleAdminCommand(data.command, data.payload);
  });

  socket.on(
    'chat:message',
    (data: { author: string; authorId: string; message: string; authorImageUrl?: string }) => {
      // Phase 11E — the client's authorId is NEVER authoritative. The score
      // identity is always this socket's verified identity; mismatched ids
      // are overridden (override+warn policy) and only display fields pass
      // through from the payload.
      const identity = socket.data.identity as SocketIdentity;
      const author =
        typeof data.author === 'string' && data.author.trim().length > 0
          ? data.author
          : identity.displayName || 'لاعب';
      gameManager.dispatchChat({
        author,
        authorId: authoritativeAuthorId(socket, data.authorId) ?? identity.canonicalPlayerId,
        // Real YouTube messages carry the avatar from the Live Chat API; local
        // clients may supply theirs too so identity flows identically.
        authorImageUrl: data.authorImageUrl ?? identity.avatarUrl ?? undefined,
        message: typeof data.message === 'string' ? data.message : '',
        timestamp: Date.now(),
        isModerator: false,
        socketId: socket.id,
      });
    }
  );

  socket.on('youtube:connect', (data: { videoId: string }) => {
    if (!isBroadcaster(socket)) {
      rejectUnauthorized(socket, 'youtube:connect');
      sendYouTubeStatus(socket.id, 'يتطلب ربط البث مستخدمًا مسجلاً الدخول.');
      return;
    }
    // Manual connect always supersedes any supervised retry.
    cancelReconnect();
    void connectYouTube(data.videoId, socket.id);
  });

  socket.on('youtube:disconnect', () => {
    if (!isBroadcaster(socket)) {
      rejectUnauthorized(socket, 'youtube:disconnect');
      return;
    }
    cancelReconnect();
    disconnectYouTube();
    broadcastYouTubeStatus(undefined, 'manual');
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeGame: gameManager.getActiveGameId() });
});

app.get('/api/games', (_req, res) => {
  res.json({ games: gameManager.getRegisteredGames(), active: gameManager.getActiveGameId() });
});

app.get('/api/leaderboard', (_req, res) => {
  res.json({ entries: gameManager.getLeaderboard() });
});

// Phase 13 — all-time leaderboard over persisted score events. Additive
// READ only: gameId validated against registered games, limit clamped 1-100.
app.get('/api/leaderboard/all-time', (req, res) => {
  const rawGame = typeof req.query.gameId === 'string' ? req.query.gameId.trim() : '';
  if (rawGame) {
    const known = new Set(gameManager.getRegisteredGames().map((g) => g.id));
    if (!known.has(rawGame)) {
      res.status(400).json({ error: 'invalidGameId' });
      return;
    }
  }
  const rawLimit = Number(req.query.limit);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, Math.floor(rawLimit)))
    : 50;
  res.json({ entries: getGlobalLeaderboard(rawGame || null, limit) });
});

// ---------------------------------------------------------------------------
// Phase 19 completion — single-origin production hosting.
// When the client has been built (client/dist), serve it from this process so
// browsers reach API + Socket.IO on the SAME origin. Dev (Vite :3000 proxy)
// is unaffected: this directory does not exist unless the client was built.
// ---------------------------------------------------------------------------
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[Falfoos] Serving client from ${clientDist}`);
}

// Fail loudly and clearly if the port cannot be bound — this is the root cause
// behind "server started" followed by endless proxy ECONNREFUSED: a second
// instance (or leftover process) makes the child die silently under ts-node-dev.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error('==========================================================');
    console.error(`[Falfoos] FATAL: Port ${PORT} is already in use.`);
    console.error('[Falfoos] Another Falfoos server instance is still running.');
    console.error('[Falfoos] أغلق نسخة السيرفر الأخرى العاملة على المنفذ ' + PORT + ' ثم أعد التشغيل.');
    console.error('[Falfoos] Fix on Windows : netstat -ano | findstr :' + PORT);
    console.error('==========================================================');
  } else {
    console.error('[Falfoos] Server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`[Falfoos] Server running on port ${PORT}`);
  console.log(`[Falfoos] Registered games: ${gameManager.getRegisteredGames().map((g) => g.id).join(', ')}`);
  if (env.ADMIN_TOKEN) {
    console.log('[Falfoos] Admin authorization: ADMIN_TOKEN loaded from environment');
  } else {
    console.log('[Falfoos] Admin authorization: ADMIN_TOKEN not set — ephemeral token for this boot:');
    console.log(`[Falfoos] ADMIN_TOKEN=${ADMIN_TOKEN}`);
  }
  if (youtubeApiKey) {
    console.log('[YouTubeChat] Integration ready (awaiting connection)');
  } else {
    console.log('[YouTubeChat] Integration disabled (missing YOUTUBE_API_KEY)');
  }
});
