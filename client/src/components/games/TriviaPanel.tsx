import { GameState, TriviaGameState } from '../../types/game';
import { LobbyPanel } from '../game-room/LobbyPanel';

export function TriviaPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as TriviaGameState;
  const players = state.players ?? [];

  if (state.phase === 'idle') {
    return (
      <LobbyPanel
        title="أسئلة عامة"
        icon="🎯"
        accent="var(--neon-cyan)"
        players={players}
        instruction="اكتب !انضم في البث للانضمام إلى اللاعبين"
        commandHint="أجب عبر كتابة 1 أو 2 أو 3 أو 4 في الدردشة"
        hideHeader
      >
        <div className="text-center text-sm text-[var(--text-muted)] mt-4">
          اضغط «ابدأ» من لوحة التحكم لإطلاق الجولات
        </div>
      </LobbyPanel>
    );
  }

  if (state.phase === 'finished') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-5xl mb-3">🏆</div>
          <div className="glow-text-yellow text-4xl font-extrabold">انتهت اللعبة</div>
          <div className="text-[var(--text-dim)] mt-2 text-lg">تم إكمال {state.totalRounds} جولة!</div>
        </div>
      </div>
    );
  }

  const urgent = typeof state.timeLeft === 'number' && state.timeLeft <= 5;

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div className="flex gap-2 items-center">
          <span className="badge badge-cyan badge-lg">جولة {state.roundNumber}/{state.totalRounds}</span>
          {state.currentQuestion && (
            <span className="badge badge-purple badge-lg">{state.currentQuestion.category}</span>
          )}
          <span className="badge badge-pink badge-lg">✍️ {state.totalAnswered} أجابوا</span>
          <span className="badge badge-green badge-lg">👥 {state.playerCount ?? players.length}</span>
        </div>
        <div
          className={`stat-timer ${urgent ? 'stat-timer-urgent' : ''}`}
          style={{ color: urgent ? 'var(--neon-red)' : 'var(--neon-cyan)' }}
        >
          ⏱ {state.timeLeft}ث
        </div>
      </div>

      <div className="instruction-hint">
        اكتب رقم الإجابة (<strong>1</strong> - <strong>4</strong>) في دردشة البث
      </div>

      {state.currentQuestion ? (
        <>
          <div className="card question-card glow-border-cyan">
            {state.currentQuestion.question}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 content-start">
            {state.currentQuestion.choices.map((choice, i) => {
              const num = i + 1;
              const isCorrect = state.roundFinished && state.correctAnswer === String(num);
              const isWrong = state.roundFinished && !isCorrect;

              return (
                <div
                  key={i}
                  className={`card choice-card animate-fade-in ${
                    isCorrect ? 'choice-correct' : isWrong ? 'choice-dim' : ''
                  }`}
                >
                  <span className={`choice-num ${isCorrect ? 'choice-num-correct' : ''}`}>{num}</span>
                  <span>{choice}</span>
                  {isCorrect && <span className="ms-auto text-neon-green text-xl font-bold">✓</span>}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center flex-1 text-[var(--text-dim)] text-lg">
          تحضير السؤال التالي…
        </div>
      )}
    </div>
  );
}
