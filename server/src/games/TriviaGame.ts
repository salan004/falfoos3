import {
  BaseGame,
  GameConfig,
  ChatMessage,
  GamePhase,
  PlayerIdentity,
  GameEvent,
} from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';
import { calculateSpeedBonus } from '../utils/scoring';
import { getRandomQuestions, markQuestionAsUsed, TriviaQuestion as DbTriviaQuestion } from './trivia/QuestionPoolService';

/** Internal question format with 1-based correctAnswer for backwards compatibility with existing game logic. */
interface TriviaQuestion {
  id: string;
  category: string;
  question: string;
  choices: string[];
  correctAnswer: string;      // "1" | "2" | "3" | "4" (1-based for external consistency)
  correct_idx: number;        // 0-3 (0-based internal)
  difficulty: string;
}

interface AnswerRecord {
  playerId: string;
  displayName: string;
  answer: string;
  responseTimeMs: number;
}

export interface PlayerStats {
  score: number;
  correctAnswers: number;
  wrongAnswers: number;
  totalResponseTimeMs: number;
  answeredQuestionCount: number;
}

interface TriviaState {
  phase: GamePhase;
  category: string;
  currentQuestionIndex: number;
  currentQuestion: TriviaQuestion | null;
  answersThisRound: AnswerRecord[];
  roundNumber: number;
  totalRounds: number;
  questionStartedAt: number;
  timeLeft: number;
  answerTimerSeconds: number;
  showTimerSeconds: number;
  correctAnswer: string | null;
  roundFinished: boolean;
  answerWindowOpen: boolean;
  players: { id: string; displayName: string; avatarUrl?: string }[];
  usedQuestionIds: string[];
  playerStats: Map<string, PlayerStats>;
}

export function createInitialPlayerStats(): PlayerStats {
  return {
    score: 0,
    correctAnswers: 0,
    wrongAnswers: 0,
    totalResponseTimeMs: 0,
    answeredQuestionCount: 0,
  };
}

export function fisherYatesShuffle<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function calculateRanking(
  players: { id: string; displayName: string; avatarUrl?: string }[],
  playerStats: Map<string, PlayerStats>
): { id: string; displayName: string; score: number; correctAnswers: number; wrongAnswers: number; avgResponseTimeMs: number }[] {
  const ranked = players.map((p) => {
    const stats = playerStats.get(p.id) ?? createInitialPlayerStats();
    const avgResponseTime = stats.answeredQuestionCount > 0
      ? stats.totalResponseTimeMs / stats.answeredQuestionCount
      : 0;
    return {
      id: p.id,
      displayName: p.displayName,
      score: stats.score,
      correctAnswers: stats.correctAnswers,
      wrongAnswers: stats.wrongAnswers,
      avgResponseTimeMs: avgResponseTime,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.wrongAnswers !== b.wrongAnswers) return a.wrongAnswers - b.wrongAnswers;
    if (a.avgResponseTimeMs !== b.avgResponseTimeMs) return a.avgResponseTimeMs - b.avgResponseTimeMs;
    return 0;
  });

  return ranked;
}

/** Converts a database question (0-based correct_idx) to internal format (1-based correctAnswer). */
function convertDbQuestion(dbQ: DbTriviaQuestion): TriviaQuestion {
  return {
    id: dbQ.id,
    category: dbQ.category,
    question: dbQ.question,
    choices: dbQ.choices,
    correctAnswer: String(dbQ.correct_idx + 1),  // Convert 0-based to 1-based string
    correct_idx: dbQ.correct_idx,
    difficulty: dbQ.difficulty,
  };
}

export class TriviaGame extends BaseGame {
  readonly config: GameConfig = {
    id: 'trivia',
    name: 'أسئلة عامة',
    description: 'أجب عن الأسئلة من 4 فئات. أسرع إجابة صحيحة تحصل على نقاط أكثر! اكتب 1 أو 2 أو 3 أو 4 للإجابة',
    minPlayers: 1,
  };

  state: TriviaState = this.initialState();
  private gameManagerRef: {
    updateScore: (pid: string, name: string, delta: number, avatarUrl?: string, reason?: string) => void;
    sendToSocket: (socketId: string, event: GameEvent) => void;
  } | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(gameManager: { updateScore: (pid: string, name: string, delta: number, avatarUrl?: string, reason?: string) => void; sendToSocket: (socketId: string, event: GameEvent) => void }) {
    super();
    this.gameManagerRef = gameManager;
  }

  private initialState(): TriviaState {
    return {
      phase: 'idle',
      category: 'all',
      currentQuestionIndex: 0,
      currentQuestion: null,
      answersThisRound: [],
      roundNumber: 0,
      totalRounds: 10,
      questionStartedAt: 0,
      timeLeft: 0,
      answerTimerSeconds: 15,
      showTimerSeconds: 5,
      correctAnswer: null,
      roundFinished: false,
      answerWindowOpen: false,
      players: [],
      usedQuestionIds: [],
      playerStats: new Map(),
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
    this.state.roundNumber = 0;
    this.initializePlayerStats();
    this.broadcastGameState();
    this.nextQuestion();
  }

  stop(): void {
    this.clearTimers();
    this.state.phase = 'idle';
    this.broadcastGameState();
  }

  reset(): void {
    this.clearTimers();
    this.state = this.initialState();
  }

  private initializePlayerStats(): void {
    this.state.playerStats.clear();
    for (const player of this.state.players) {
      this.state.playerStats.set(player.id, createInitialPlayerStats());
    }
  }

  private ensurePlayerStats(playerId: string): PlayerStats {
    let stats = this.state.playerStats.get(playerId);
    if (!stats) {
      stats = createInitialPlayerStats();
      this.state.playerStats.set(playerId, stats);
    }
    return stats;
  }

  handleChatMessage(msg: ChatMessage): void {
    if (this.state.phase !== 'playing') return;
    if (!this.state.currentQuestion) return;

    const normalized = normalizeChatCommand(msg.message);

    const validMatch = normalized.match(/^!?([1-4])$/);
    if (validMatch) {
      const answerStr = validMatch[1];

      if (!this.state.answerWindowOpen || this.state.roundFinished) {
        this.sendRejection(msg.socketId, 'answer_closed', 'انتهى وقت الإجابة');
        return;
      }

      const alreadyAnswered = this.state.answersThisRound.some(
        (a) => a.playerId === msg.authorId
      );
      if (alreadyAnswered) {
        this.sendRejection(msg.socketId, 'already_answered', 'تم تسجيل إجابتك بالفعل');
        return;
      }

      const responseTime = Date.now() - this.state.questionStartedAt;
      this.state.answersThisRound.push({
        playerId: msg.authorId,
        displayName: msg.author,
        answer: answerStr,
        responseTimeMs: responseTime,
      });

      this.ensureRegistered({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl });
      this.ensurePlayerStats(msg.authorId);

      this.sendAcceptance(msg.socketId, {
        round: this.state.roundNumber,
        answer: answerStr,
        responseTimeMs: responseTime,
      });

      this.broadcastGameState();
      return;
    }

    const invalidMatch = normalized.match(/^!?([05-9])$/);
    if (invalidMatch) {
      if (!this.state.answerWindowOpen || this.state.roundFinished) {
        this.sendRejection(msg.socketId, 'answer_closed', 'انتهى وقت الإجابة');
      } else {
        this.sendRejection(msg.socketId, 'invalid_answer', 'اختر إجابة من 1 إلى 4');
      }
      return;
    }
  }

  private sendAcceptance(socketId: string | undefined, payload: { round: number; answer: string; responseTimeMs: number }): void {
    if (!socketId || !this.gameManagerRef) return;
    this.gameManagerRef.sendToSocket(socketId, {
      type: 'game:answerAccepted',
      payload,
      timestamp: Date.now(),
    });
  }

  private sendRejection(socketId: string | undefined, reason: string, message: string): void {
    if (!socketId || !this.gameManagerRef) return;
    this.gameManagerRef.sendToSocket(socketId, {
      type: 'game:answerRejected',
      payload: { reason, message },
      timestamp: Date.now(),
    });
  }

  private ensureRegistered(identity: PlayerIdentity): void {
    if (this.tryRegisterPlayer(this.state.players, identity, () => ({
      id: identity.authorId,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
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
      this.ensurePlayerStats(identity.authorId);
    }
  }

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

    this.ensureRegistered(identity);
    this.broadcastGameState();
  }

  handleAdminCommand(command: string, payload?: unknown): void {
    switch (command) {
      case 'trivia:start':
        if (typeof payload === 'string') {
          this.state.category = payload;
        }
        this.start();
        break;
      case 'trivia:next':
        this.finishRoundEarly();
        break;
      case 'trivia:setTimer':
        if (typeof payload === 'number') {
          this.state.answerTimerSeconds = payload;
        }
        break;
      case 'trivia:setRounds':
        if (typeof payload === 'number') {
          this.state.totalRounds = payload;
        }
        break;
    }
  }

  private nextQuestion(): void {
    this.clearTimers();
    this.state.answersThisRound = [];
    this.state.roundFinished = false;
    this.state.correctAnswer = null;
    this.state.roundNumber++;

    if (this.state.roundNumber > this.state.totalRounds) {
      this.finishGame();
      return;
    }

    // Fetch random questions from the database, excluding already used ones
    const questions = getRandomQuestions(
      this.state.totalRounds - this.state.roundNumber + 1, // fetch enough for remaining rounds
      this.state.category === 'all' ? undefined : { category: this.state.category },
      this.state.usedQuestionIds
    );

    if (questions.length === 0) {
      this.finishGame();
      return;
    }

    // Convert first question to internal format
    this.state.currentQuestion = convertDbQuestion(questions[0]);
    this.state.usedQuestionIds.push(this.state.currentQuestion.id || '');
    this.state.currentQuestionIndex = 1; // We'll use the fetched array if we pre-fetch more

    // Mark the question as used for cross-match rotation
    // Only the actually displayed question gets recorded, not prefetched ones
    markQuestionAsUsed(this.state.currentQuestion.id, this.sessionId);

    this.broadcast({
      type: 'trivia:showingQuestion',
      payload: {
        round: this.state.roundNumber,
        total: this.state.totalRounds,
        question: this.state.currentQuestion.question,
        choices: this.state.currentQuestion.choices,
        category: this.state.currentQuestion.category,
        difficulty: this.state.currentQuestion.difficulty,
      },
      timestamp: Date.now(),
    });

    this.state.phase = 'playing';
    this.state.answerWindowOpen = false;
    this.state.questionStartedAt = Date.now();
    this.state.timeLeft = this.state.showTimerSeconds;

    const showTimer = setInterval(() => {
      this.state.timeLeft--;
      this.broadcastGameState();
      if (this.state.timeLeft <= 0) {
        clearInterval(showTimer);
        this.state.timeLeft = this.state.answerTimerSeconds;
        this.state.answerWindowOpen = true;

        this.broadcast({
          type: 'trivia:answerOpen',
          payload: { timeLimit: this.state.answerTimerSeconds },
          timestamp: Date.now(),
        });

        const answerTimer = setInterval(() => {
          this.state.timeLeft--;
          this.broadcastGameState();
          if (this.state.timeLeft <= 0) {
            clearInterval(answerTimer);
            this.revealAnswer();
          }
        }, 1000);
        this.timers.push(answerTimer);
      }
    }, 1000);
    this.timers.push(showTimer);
  }

  private revealAnswer(): void {
    this.clearTimers();
    if (!this.state.currentQuestion) return;
    this.state.roundFinished = true;
    this.state.answerWindowOpen = false;
    this.state.correctAnswer = this.state.currentQuestion.correctAnswer;

    const correctAnswerStr = this.state.currentQuestion.correctAnswer;

    for (const record of this.state.answersThisRound) {
      const stats = this.ensurePlayerStats(record.playerId);
      stats.answeredQuestionCount++;
      stats.totalResponseTimeMs += record.responseTimeMs;

      if (record.answer === correctAnswerStr) {
        const points = 100 + Math.floor(calculateSpeedBonus(record.responseTimeMs, 50, 5));
        stats.score += points;
        stats.correctAnswers++;
        const rosterAvatar = this.state.players.find((p) => p.id === record.playerId)?.avatarUrl;
        this.gameManagerRef?.updateScore(record.playerId, record.displayName, points, rosterAvatar, 'trivia:correctAnswer');
      } else {
        stats.wrongAnswers++;
      }
    }

    const correctIdx = this.state.currentQuestion.correct_idx;

    this.broadcast({
      type: 'trivia:answerRevealed',
      payload: {
        correctAnswer: this.state.correctAnswer,
        correctText: this.state.currentQuestion.choices[correctIdx],
        totalAnswers: this.state.answersThisRound.length,
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();

    const nextTimer = setTimeout(() => {
      this.nextQuestion();
    }, 5000);
    this.timers.push(nextTimer);
  }

  private finishRoundEarly(): void {
    if (this.state.phase === 'playing' && !this.state.roundFinished) {
      this.revealAnswer();
    }
  }

  private finishGame(): void {
    this.state.phase = 'finished';

    const ranked = calculateRanking(this.state.players, this.state.playerStats);

    let winnerIds: string[] = [];
    if (ranked.length > 0) {
      const topScore = ranked[0].score;
      winnerIds = ranked
        .filter((p) => p.score === topScore)
        .map((p) => p.id);
    }

    this.announceWinners(winnerIds, 'match');

    this.broadcast({
      type: 'trivia:finished',
      payload: {
        ranking: ranked,
      },
      timestamp: Date.now(),
    });

    this.broadcastGameState();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  getPublicState(): Record<string, unknown> {
    const statusByPlayer = new Map<string, string>();
    if (this.state.roundFinished && this.state.currentQuestion) {
      for (const record of this.state.answersThisRound) {
        statusByPlayer.set(
          record.playerId,
          record.answer === this.state.currentQuestion.correctAnswer ? 'correct' : 'wrong'
        );
      }
    }

    const ranked = calculateRanking(this.state.players, this.state.playerStats);

    return {
      gameId: this.config.id,
      sessionId: this.sessionId,
      phase: this.state.phase,
      roundNumber: this.state.roundNumber,
      totalRounds: this.state.totalRounds,
      category: this.state.category,
      currentQuestion: this.state.currentQuestion
        ? {
            question: this.state.currentQuestion.question,
            choices: this.state.currentQuestion.choices,
            category: this.state.currentQuestion.category,
            difficulty: this.state.currentQuestion.difficulty,
          }
        : null,
      correctAnswer: this.state.roundFinished ? this.state.correctAnswer : null,
      timeLeft: this.state.timeLeft,
      roundFinished: this.state.roundFinished,
      totalAnswered: this.state.answersThisRound.length,
      playerCount: this.state.players.length,
      players: this.state.players.map((p) => {
        const stats = this.state.playerStats.get(p.id) ?? createInitialPlayerStats();
        const rankedEntry = ranked.find((r) => r.id === p.id);
        return {
          id: p.id,
          displayName: p.displayName,
          avatarUrl: p.avatarUrl,
          status: statusByPlayer.get(p.id) ?? 'playing',
          score: stats.score,
          correctAnswers: stats.correctAnswers,
          wrongAnswers: stats.wrongAnswers,
          rank: rankedEntry ? ranked.indexOf(rankedEntry) + 1 : null,
        };
      }),
      ranking: this.state.phase === 'finished' ? ranked : undefined,
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}