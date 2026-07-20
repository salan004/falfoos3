import { GameState, HideSeekGameState } from '../../types/game';

const ALL_ZONES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4'];

export function HideSeekPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as HideSeekGameState;
  const searchedZones = new Set(state.searchedZones ?? []);
  const hiddenCount = state.players?.filter((p) => p.zone && !p.isCaught).length ?? 0;
  const caughtCount = state.players?.filter((p) => p.isCaught).length ?? 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <span className="badge badge-cyan">Hide & Seek</span>
        <span className="badge badge-green">{state.players?.length ?? 0} players</span>
        <span className="badge badge-pink">{hiddenCount} hidden</span>
        <span className="badge badge-red">{caughtCount} caught</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '6px',
          flex: 1,
          alignContent: 'start',
        }}
      >
        {ALL_ZONES.map((zone) => {
          const isSearched = searchedZones.has(zone);
          const playersHere = state.players?.filter((p) => p.zone === zone) ?? [];
          const caughtHere = playersHere.filter((p) => p.isCaught);

          return (
            <div
              key={zone}
              className="card"
              style={{
                textAlign: 'center',
                padding: '12px 8px',
                borderColor: isSearched
                  ? caughtHere.length > 0
                    ? 'var(--neon-red)'
                    : 'var(--neon-green)'
                  : 'var(--border-color)',
                background: isSearched
                  ? caughtHere.length > 0
                    ? 'rgba(255,51,85,0.08)'
                    : 'rgba(0,255,136,0.05)'
                  : 'var(--bg-card)',
              }}
            >
              <div
                className="neon-text"
                style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
              >
                {zone}
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                {playersHere.length} hidden
              </div>
              {isSearched && (
                <div style={{ fontSize: '0.65rem', marginTop: '2px' }}>
                  {caughtHere.length > 0 ? (
                    <span style={{ color: 'var(--neon-red)' }}>☠ {caughtHere.map((p) => p.displayName).join(', ')}</span>
                  ) : (
                    <span style={{ color: 'var(--neon-green)' }}>✓ Clear</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
