import { GameState, GuessingGameState } from '../../types/game';
import { LobbyPanel } from '../game-room/LobbyPanel';
import { PlayerAvatar } from '../PlayerAvatar';

export function GuessingPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as GuessingGameState;
  const participants = state.participants ?? [];

  if (state.winner) {
    const winner = participants.find((p) => p.id === (state.winnerId ?? ''));
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div className="text-5xl">🎉</div>
          <div className="glow-text-green text-3xl font-extrabold">إجابة صحيحة!</div>
          {winner && (
            <PlayerAvatar id={winner.id} name={winner.displayName} avatarUrl={winner.avatarUrl} size={64} />
          )}
          <div className="text-2xl font-extrabold glow-text-cyan">{state.winner}</div>
          <div className="text-lg text-[var(--text-dim)]">
            الإجابة: <strong className="glow-text-yellow">{state.answer}</strong>
          </div>
        </div>
      </div>
    );
  }

  if (state.phase !== 'playing' || !state.answer) {
    return (
      <LobbyPanel
        title="لعبة التخمين"
        icon="🤔"
        accent="var(--neon-yellow)"
        players={participants}
        instruction="اكتب !انضم في البث للانضمام إلى المشاركين"
        commandHint="حالما يضع المضيف الإجابة، خمّن عبر !تخمين <إجابتك>"
        hideHeader
      >
        <div className="text-center text-sm text-[var(--text-muted)] mt-4">
          {state.phase === 'playing'
            ? 'في انتظار المضيف لتحديد الإجابة…'
            : 'اضغط «بدء» من لوحة التحكم ثم حدّد الإجابة'}
        </div>
      </LobbyPanel>
    );
  }

  return (
    <div className="h-full flex flex-col items-center gap-5 justify-center">
      <div className="flex gap-2 flex-wrap justify-center">
        <span className="badge badge-cyan badge-lg">👥 {participants.length} مشارك</span>
        <span className="badge badge-pink badge-lg animate-pulse">التخمين مفتوح</span>
      </div>

      <div className="instruction-hint">
        اكتب <strong>!تخمين</strong> متبوعة بتخمينك في دردشة البث
      </div>

      {state.hints.length > 0 && (
        <div className="card glow-border-yellow" style={{ fontSize: '2rem', letterSpacing: '10px', fontFamily: 'var(--font-mono)', padding: '18px 32px' }}>
          {state.hints.map((h, i) => (
            <span key={i}>{i === 0 ? h : '_'} </span>
          ))}
        </div>
      )}

      {participants.length > 0 && (
        <div className="players-grid w-full mt-2">
          {participants.map((p) => (
            <div key={p.id} className="card player-chip">
              <PlayerAvatar id={p.id} name={p.displayName} avatarUrl={p.avatarUrl} size={34} />
              <span className="player-chip-name">{p.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
