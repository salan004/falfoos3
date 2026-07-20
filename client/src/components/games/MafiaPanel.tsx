import { GameState, MafiaGameState } from '../../types/game';

export function MafiaPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as MafiaGameState;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span className="badge badge-cyan">Mafia</span>
        <span className="badge badge-green">{state.players?.length ?? 0} players</span>
        {state.nightPhase && <span className="badge badge-pink animate-pulse">Night Phase</span>}
      </div>
      {(!state.players || state.players.length === 0) ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: 'var(--text-dim)' }}>
          Wait for players to !join, then assign roles
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px', flex: 1, overflow: 'auto' }}>
          {state.players.map((p) => (
            <div
              key={p.id}
              className="card"
              style={{
                textAlign: 'center',
                padding: '10px',
                opacity: p.isAlive ? 1 : 0.4,
                borderColor: p.role === 'mafia' ? 'var(--neon-red)' : p.role === 'detective' ? 'var(--neon-cyan)' : p.role === 'doctor' ? 'var(--neon-green)' : 'var(--border-color)',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{p.displayName}</div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {p.role.charAt(0).toUpperCase() + p.role.slice(1)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
