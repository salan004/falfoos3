import { GameState, GuessingGameState } from '../../types/game';

export function GuessingPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as GuessingGameState;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center' }}>
      <div className="neon-text" style={{ fontSize: '1.6rem', fontWeight: 800 }}>GUESSING GAME</div>
      {state.winner ? (
        <div style={{ textAlign: 'center' }}>
          <div className="neon-text-pink" style={{ fontSize: '1.3rem', fontWeight: 700 }}>
            {state.winner} guessed correctly!
          </div>
          <div style={{ color: 'var(--neon-green)', fontSize: '1.1rem', marginTop: '8px' }}>
            Answer: {state.answer}
          </div>
        </div>
      ) : state.phase === 'playing' && state.answer ? (
        <>
          <div style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
            The answer is set! Type <strong>!guess [your answer]</strong> in chat.
          </div>
          {state.hints.length > 0 && (
            <div className="card" style={{ fontSize: '1.5rem', letterSpacing: '8px', fontFamily: 'var(--font-mono)' }}>
              {state.hints.map((h, i) => (
                <span key={i}>{i === 0 ? h : '_'} </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div style={{ color: 'var(--text-dim)' }}>
          Set an answer to begin
        </div>
      )}
    </div>
  );
}
