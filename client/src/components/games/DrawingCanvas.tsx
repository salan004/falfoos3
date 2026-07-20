import { GameState, DrawingGameState } from '../../types/game';

export function DrawingCanvas({ gameState }: { gameState: GameState }) {
  const state = gameState as DrawingGameState;
  const grid = state.grid ?? [];
  const size = state.gridSize ?? 16;
  const cellSize = Math.min(12, Math.floor(400 / size));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span className="badge badge-cyan">Drawing Canvas</span>
        {state.currentWord && !state.wordAnswered && (
          <span className="badge badge-pink animate-pulse">Word set — guessing open!</span>
        )}
        {state.wordAnswered && (
          <span className="badge badge-green">Word guessed!</span>
        )}
      </div>
      {grid.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${size}, ${cellSize}px)`,
            gap: '1px',
            background: 'var(--border-color)',
            padding: '1px',
            borderRadius: '4px',
          }}
        >
          {grid.map((row, ri) =>
            row.map((color, ci) => (
              <div
                key={`${ri}-${ci}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  background: color,
                  borderRadius: '1px',
                }}
              />
            ))
          )}
        </div>
      ) : (
        <div style={{ color: 'var(--text-dim)' }}>Grid initializing...</div>
      )}
      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
        Type <strong>!draw B5 #ff00aa</strong> to color a pixel
      </div>
    </div>
  );
}
