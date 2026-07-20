import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { GameManager } from './core/GameManager';
import { TriviaGame } from './games/TriviaGame';
import { MusicalChairsGame } from './games/MusicalChairsGame';
import { MafiaGame } from './games/MafiaGame';
import { GuessingGame } from './games/GuessingGame';
import { DrawingGame } from './games/DrawingGame';
import { HideSeekGame } from './games/HideSeekGame';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

const gameManager = new GameManager();
gameManager.setSocketServer(io);

const triviaGame = new TriviaGame(gameManager);
const musicalChairsGame = new MusicalChairsGame();
const mafiaGame = new MafiaGame();
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

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  socket.emit('game:list', { games: gameManager.getRegisteredGames() });
  socket.emit('game:active', { gameId: gameManager.getActiveGameId() });

  const activeGame = gameManager.getActiveGame();
  if (activeGame) {
    socket.emit('game:state', {
      type: 'game:state',
      payload: { gameId: activeGame.config.id, ...activeGame.state },
      timestamp: Date.now(),
    });
  }

  socket.on('admin:command', (data: { command: string; payload?: unknown }) => {
    console.log(`[Socket] Admin command: ${data.command}`, data.payload);
    gameManager.handleAdminCommand(data.command, data.payload);
  });

  socket.on('chat:message', (data: { author: string; authorId: string; message: string }) => {
    gameManager.dispatchChat({
      author: data.author,
      authorId: data.authorId,
      message: data.message,
      timestamp: Date.now(),
      isModerator: false,
    });
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

server.listen(PORT, () => {
  console.log(`[Falfoos] Server running on port ${PORT}`);
  console.log(`[Falfoos] Registered games: ${gameManager.getRegisteredGames().map((g) => g.id).join(', ')}`);
});
