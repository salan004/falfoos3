import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MafiaDeadList } from '../components/MafiaDeadList';
import { MAFIA_TEXT } from '../mafia-text';
import type { MafiaGameState } from '../../../../types/game';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';

interface MafiaDayProps {
  state: MafiaGameState;
  timerWindow: MafiaPhaseWindow | null;
  currentPlayerId?: string | null;
}

export function MafiaDay({ state, timerWindow }: MafiaDayProps) {
  const players = state.players ?? [];
  const deadPlayers = players.filter((p) => !p.isAlive);
  const aliveCount = typeof state.aliveCount === 'number'
    ? state.aliveCount
    : players.filter((p) => p.isAlive).length;
  const eliminated = state.eliminatedToday
    ? players.find((p) => p.id === state.eliminatedToday)
    : null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-yellow text-lg">☀️ {MAFIA_TEXT.phases.day} {state.round}</span>
        </div>
        <MafiaPhaseTimer window={timerWindow} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, overflow: 'auto' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-yellow">☀️ {MAFIA_TEXT.phases.day}</span>
            <span className="badge badge-green">{aliveCount} {MAFIA_TEXT.labels.aliveSuffix}</span>
          </div>

          {eliminated ? (
            <div className="panel" style={{ borderColor: 'var(--neon-red)', background: 'rgba(255,51,85,0.05)' }}>
              <div className="text-sm text-[var(--neon-red)] font-bold mb-1">
                💀 {MAFIA_TEXT.messages.dayEliminated(eliminated.displayName)}
              </div>
              {eliminated.role !== 'مجهول' && (
                <div className="text-sm text-[var(--text-dim)] mt-1">
                  {MAFIA_TEXT.labels.roleWas}:{' '}
                  <span className="font-bold">
                    {MAFIA_TEXT.roles[eliminated.role.toLowerCase() as keyof typeof MAFIA_TEXT.roles] || eliminated.role}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="panel" style={{ borderColor: 'var(--neon-green)', background: 'rgba(0,255,136,0.05)' }}>
              <div className="text-sm text-[var(--neon-green)] font-bold mb-1">🛡️ {MAFIA_TEXT.messages.dayNoEliminated}</div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
            {players.map((p) => (
              <MafiaPlayerCard key={p.id} player={p} />
            ))}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-yellow">💬 {MAFIA_TEXT.messages.discussTitle}</span>
          </div>

          <div className="panel" style={{ background: 'rgba(255,221,0,0.05)', borderColor: 'var(--neon-yellow)' }}>
            <div className="text-sm text-[var(--neon-yellow)] font-bold mb-2">💬 {MAFIA_TEXT.messages.discussTitle}</div>
            <div className="text-sm text-[var(--text-dim)]">
              {MAFIA_TEXT.messages.discussBody}
            </div>
            <div className="text-sm text-[var(--neon-cyan)] mt-2 font-bold">
              {MAFIA_TEXT.actions.vote}
            </div>
          </div>

          <div className="text-sm text-[var(--text-muted)] text-center pt-2 border-t border-[var(--border-color)]">
            {MAFIA_TEXT.labels.roundLabel} {state.round}
          </div>
        </div>
      </div>

      <MafiaDeadList deadPlayers={deadPlayers} />
    </div>
  );
}
