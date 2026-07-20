import { GameState, TriviaGameState } from '../../types/game';

export function TriviaPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as TriviaGameState;

  if (state.phase === 'idle') {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-dim)]">
        <div className="text-center">
          <div className="neon-text text-3xl font-extrabold mb-2">أسئلة عامة</div>
          <div className="text-sm">اضغط <strong>Start Trivia</strong> في لوحة التحكم للبدء</div>
        </div>
      </div>
    );
  }

  if (state.phase === 'finished') {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="neon-text text-3xl font-extrabold">انتهت اللعبة</div>
          <div className="text-[var(--text-dim)] mt-2">تم إكمال {state.totalRounds} جولة!</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-3 items-center">
          <span className="badge badge-cyan">جولة {state.roundNumber}/{state.totalRounds}</span>
          {state.currentQuestion && (
            <span className="badge badge-green">{state.currentQuestion.category}</span>
          )}
          <span className="badge badge-pink">{state.totalAnswered} أجابوا</span>
        </div>
        <div className="flex gap-2 items-center">
          <div
            className="neon-text text-2xl font-bold font-mono"
            style={{ animation: state.phase === 'playing' ? 'pulse 1s infinite' : 'none' }}
          >
            {state.timeLeft}ث
          </div>
        </div>
      </div>

      <div className="text-center text-[0.75rem] text-[var(--text-dim)] mb-1">
        اكتب <strong className="text-[var(--neon-cyan)]">!1</strong> أو <strong className="text-[var(--neon-cyan)]">1</strong> للإجابة
      </div>

      {state.currentQuestion ? (
        <>
          <div className="card text-center text-lg font-semibold py-6 border-neon-cyan/50">
            {state.currentQuestion.question}
          </div>

          <div className="grid grid-cols-2 gap-3 flex-1">
            {state.currentQuestion.choices.map((choice, i) => {
              const num = i + 1;
              const isCorrect = state.roundFinished && state.correctAnswer === String(num);
              const isWrong = state.roundFinished && !isCorrect;

              return (
                <div
                  key={i}
                  className={`card animate-fade-in flex items-center gap-3 p-4 text-base transition-all duration-300 ${
                    isCorrect
                      ? 'border-neon-green/80 bg-[rgba(0,255,136,0.08)]'
                      : isWrong
                      ? 'opacity-50'
                      : ''
                  }`}
                  style={{
                    borderColor: isCorrect
                      ? 'var(--neon-green)'
                      : 'var(--border-color)',
                  }}
                >
                  <span
                    className={`badge w-7 h-7 flex items-center justify-center text-sm font-bold ${
                      isCorrect
                        ? 'bg-[rgba(0,255,136,0.2)] text-neon-green border-neon-green'
                        : 'bg-[rgba(0,240,255,0.1)] text-neon-cyan border-[rgba(0,240,255,0.3)]'
                    }`}
                  >
                    {num}
                  </span>
                  <span>{choice}</span>
                  {isCorrect && (
                    <span className="ml-auto text-neon-green text-sm">✓</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center flex-1 text-[var(--text-dim)]">
          تحضير السؤال التالي...
        </div>
      )}
    </div>
  );
}
