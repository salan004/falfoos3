import { MAFIA_TEXT, ROLE_COLORS } from '../mafia-text';
import type { MafiaGameState } from '../../../../types/game';

interface MafiaGameOverProps {
  state: MafiaGameState;
  onNewMatch?: () => void;
}

export function MafiaGameOver({ state, onNewMatch }: MafiaGameOverProps) {
  const winner = state.winner;
  const winnerTeam = winner === 'mafia' ? 'المافيا' : 'المواطنون';
  const teamColor = winner === 'mafia' ? 'var(--neon-red)' : 'var(--neon-green)';
  const teamIcon = winner === 'mafia' ? '🔪' : '🛡️';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-purple text-lg">🏁 {MAFIA_TEXT.phases.gameOver}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'auto' }}>
        <div 
          className="panel text-center"
          style={{ 
            padding: '32px', 
            background: winner === 'mafia' 
              ? 'linear-gradient(135deg, var(--neon-red), var(--neon-pink))' 
              : 'linear-gradient(135deg, var(--neon-green), var(--neon-cyan))',
            border: 'none',
          }}
        >
          <div className="text-3xl font-extrabold mb-2" style={{ color: 'white' }}>
            {teamIcon} {MAFIA_TEXT.messages[winner === 'mafia' ? 'mafiaWin' : 'citizensWin']}
          </div>
          <div className="text-xl font-bold" style={{ color: 'white' }}>
            الجولة: {state.round}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-purple">🏆 النتائج النهائية</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px' }}>
            {state.players.map((p) => {
              const role = p.role.toLowerCase();
              const color = ROLE_COLORS[role] || 'var(--border-color)';
              return (
                <div 
                  key={p.id} 
                  className="card text-center"
                  style={{ 
                    borderColor: color,
                    opacity: p.isAlive ? 1 : 0.5,
                    background: p.isAlive ? `rgba(0,0,0,0.2)` : 'rgba(255,51,85,0.05)',
                  }}
                >
                  <div className="text-xl mb-1">
                    {p.isAlive ? '👑' : '💀'}
                  </div>
                  <div className="text-sm font-semibold">{p.displayName}</div>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    {p.isAlive ? '✅ حي' : '⚰️ ميت'}
                  </div>
                  <div 
                    className="text-xs font-bold mt-1"
                    style={{ color, background: `${color}20`, padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}
                  >
                    {MAFIA_TEXT.roles[p.role.toLowerCase() as keyof typeof MAFIA_TEXT.roles] || p.role}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="panel text-center" style={{ borderColor: 'var(--neon-cyan)' }}>
          <div className="text-sm text-[var(--neon-cyan)] font-bold mb-2">🔄 خيارات</div>
          <div className="flex gap-2 justify-center">
            <button className="btn-neon text-sm" onClick={onNewMatch}>
              🔄 مباراة جديدة
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}