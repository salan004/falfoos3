import { GameState, DrawingGameState } from '../../types/game';
import { LobbyPanel } from '../game-room/LobbyPanel';
import { PlayerAvatar } from '../PlayerAvatar';

export function DrawingCanvas({ gameState }: { gameState: GameState }) {
  const state = gameState as DrawingGameState;
  const participants = state.participants ?? [];
  const grid = state.grid ?? [];
  const size = state.gridSize ?? 16;
  const cellSize = Math.min(22, Math.floor(560 / size));
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 480;
  const mobileCellSize = isMobile ? Math.min(20, Math.floor(320 / size)) : cellSize;
  const effectiveCellSize = isMobile ? mobileCellSize : cellSize;

  if (state.phase !== 'playing') {
    return (
      <LobbyPanel
        title="الرسم التفاعلي"
        icon="🎨"
        accent="var(--neon-green)"
        players={participants}
        instruction="اكتب !انضم في البث للانضمام إلى الرسامين"
        commandHint="لوّن بكسلة عبر !رسم B5 #ff00aa — أو خمّن الكلمة عبر !تخمين"
        hideHeader
      >
        <div className="text-center text-sm text-[var(--text-muted)] mt-4">
          اضغط «بدء» من لوحة التحكم لتفعيل اللوحة
        </div>
      </LobbyPanel>
    );
  }

  return (
    <div className="h-full flex flex-col items-center gap-5 justify-center">
      <div className="flex gap-2 flex-wrap justify-center items-center">
        <span className="badge badge-cyan badge-lg">👥 {participants.length} مشارك</span>
        {state.currentWord && !state.wordAnswered && (
          <span className="badge badge-pink badge-lg animate-pulse">🪄 الكلمة سرية — خمّنوها!</span>
        )}
        {state.wordAnswered && (
          <span className="badge badge-green badge-lg">
            ✅ الكلمة كانت: {state.currentWord}
            {state.wordWinner ? ` — ${state.wordWinner}` : ''}
          </span>
        )}
      </div>

      {grid.length > 0 ? (
        <div
          className="drawing-frame"
          style={{
            gridTemplateColumns: `repeat(${size}, ${effectiveCellSize}px)`,
          }}
        >
          {grid.map((row, ri) =>
            row.map((color, ci) => (
              <div
                key={`${ri}-${ci}`}
                style={{
                  width: effectiveCellSize,
                  height: effectiveCellSize,
                  background: color,
                }}
              />
            ))
          )}
        </div>
      ) : (
        <div className="text-[var(--text-dim)]">جارٍ تهيئة اللوحة…</div>
      )}

      <div className="instruction-hint" style={{ fontSize: '0.85rem' }}>
        لوِّن بكسلة: <strong>!رسم B5 #ff00aa</strong> — أو خمّن عبر <strong>!تخمين</strong>
      </div>

      {participants.length > 0 && (
        <div className="players-grid w-full mt-1">
          {participants.slice(0, 12).map((p) => (
            <div key={p.id} className="card player-chip">
              <PlayerAvatar id={p.id} name={p.displayName} avatarUrl={p.avatarUrl} size={30} />
              <span className="player-chip-name">{p.displayName}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
