import {
  BaseGame,
  GameConfig,
  ChatMessage,
  GamePhase,
  PlayerIdentity,
} from '../core/BaseGame';
import { normalizeChatCommand } from '../core/chatCommands';
import { calculateSpeedBonus } from '../utils/scoring';
import questionsData from '../data/trivia-questions.json';

interface TriviaQuestion {
  category: string;
  question: string;
  choices: string[];
  correctAnswer: string;
  difficulty: string;
}

interface AnswerRecord {
  playerId: string;
  displayName: string;
  answer: string;
  responseTimeMs: number;
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
  players: { id: string; displayName: string; avatarUrl?: string }[];
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
  } | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(gameManager: { updateScore: (pid: string, name: string, delta: number, avatarUrl?: string, reason?: string) => void }) {
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
      players: [],
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

  handleChatMessage(msg: ChatMessage): void {
    if (this.state.phase !== 'playing') return;
    if (this.state.roundFinished) return;
    if (!this.state.currentQuestion) return;

    const match = normalizeChatCommand(msg.message).match(/^!?([1-4])$/);
    if (!match) return;

    const answerStr = match[1];

    const alreadyAnswered = this.state.answersThisRound.some(
      (a) => a.playerId === msg.authorId
    );
    if (alreadyAnswered) return;

    const responseTime = Date.now() - this.state.questionStartedAt;
    this.state.answersThisRound.push({
      playerId: msg.authorId,
      displayName: msg.author,
      answer: answerStr,
      responseTimeMs: responseTime,
    });

    this.ensureRegistered({ authorId: msg.authorId, displayName: msg.author, avatarUrl: msg.authorImageUrl });

    this.broadcastGameState();
  }

  /** Registers a viewer into the roster unless already present. */
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
    }
  }

  /**
   * Global !انضم entry point. Trivia has no lobby gate — viewers can join the
   * roster at any time except after the game finished.
   */
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

    const pool = this.filterQuestions();
    if (pool.length === 0) {
      this.finishGame();
      return;
    }

    const idx = this.state.currentQuestionIndex % pool.length;
    this.state.currentQuestion = pool[idx];
    this.state.currentQuestionIndex++;

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
    this.state.questionStartedAt = Date.now();
    this.state.timeLeft = this.state.showTimerSeconds;

    const showTimer = setInterval(() => {
      this.state.timeLeft--;
      this.broadcastGameState();
      if (this.state.timeLeft <= 0) {
        clearInterval(showTimer);
        this.state.timeLeft = this.state.answerTimerSeconds;
        this.state.phase = 'playing';

        this.broadcast({
          type: 'trivia:answerOpen',
          payload: { timeLimit: this.state.answerTimerSeconds },
          timestamp: Date.now(),
        });

        // Answer phase counts down live (was a frozen setTimeout before).
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
    this.state.correctAnswer = this.state.currentQuestion.correctAnswer;

    for (const record of this.state.answersThisRound) {
      if (record.answer === this.state.currentQuestion.correctAnswer) {
        const points = 100 + Math.floor(calculateSpeedBonus(record.responseTimeMs, 50, 5));
        const rosterAvatar = this.state.players.find((p) => p.id === record.playerId)?.avatarUrl;
        this.gameManagerRef?.updateScore(record.playerId, record.displayName, points, rosterAvatar, 'trivia:correctAnswer');
      }
    }

    const correctIdx = parseInt(this.state.currentQuestion.correctAnswer) - 1;

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
    this.broadcast({
      type: 'trivia:finished',
      payload: {},
      timestamp: Date.now(),
    });
    this.broadcastGameState();
  }

  private filterQuestions(): TriviaQuestion[] {
    const questions = questionsData as TriviaQuestion[];
    if (this.state.category === 'all') return questions;
    return questions.filter((q) => q.category === this.state.category);
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  getPublicState(): Record<string, unknown> {
    // Phase 9E: per-player public status. While the round is open everyone is
    // 'playing' (who answered is not revealed early); after the reveal each
    // registered player maps to correct/wrong from the round's own records.
    const statusByPlayer = new Map<string, string>();
    if (this.state.roundFinished && this.state.currentQuestion) {
      for (const record of this.state.answersThisRound) {
        statusByPlayer.set(
          record.playerId,
          record.answer === this.state.currentQuestion.correctAnswer ? 'correct' : 'wrong'
        );
      }
    }

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
      // The raw answer never leaves the server — clients only get it after reveal.
      correctAnswer: this.state.roundFinished ? this.state.correctAnswer : null,
      timeLeft: this.state.timeLeft,
      roundFinished: this.state.roundFinished,
      totalAnswered: this.state.answersThisRound.length,
      playerCount: this.state.players.length,
      players: this.state.players.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        status: statusByPlayer.get(p.id) ?? 'playing',
      })),
    };
  }

  private broadcastGameState(): void {
    this.broadcast({ type: 'game:state', payload: this.getPublicState(), timestamp: Date.now() });
  }
}
