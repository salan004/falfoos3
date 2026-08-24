import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MafiaDeadList } from '../components/MafiaDeadList';
import { MAFIA_TEXT } from '../mafia-text';
import type { MafiaGameState } from '../../../../types/game';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';

interface MafiaNightProps {
  state: MafiaGameState;
  timerWindow: MafiaPhaseWindow | null;
}

export function MafiaNight({ state, timerWindow }: MafiaNightProps) {
  const deadPlayers = state.players.filter((p) => !p.isAlive);
  const aliveCount = typeof state.aliveCount === 'number'
    ? state.aliveCount
    : state.players.filter((p) => p.isAlive).length;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-pink text-lg">🌙 {MAFIA_TEXT.phases.night} {state.round}</span>
        </div>
        <MafiaPhaseTimer window={timerWindow} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, overflow: 'auto' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-pink">🌙 {MAFIA_TEXT.labels.nightActionsTitle}</span>
            <span className="badge badge-green">{aliveCount} {MAFIA_TEXT.labels.aliveSuffix}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
            {state.players.map((p) => (
              <MafiaPlayerCard key={p.id} player={p} />
            ))}
          </div>

          <div className="text-sm text-[var(--text-muted)] text-center pt-2 border-t border-[var(--border-color)]">
            {MAFIA_TEXT.labels.roundLabel} {state.round}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-pink">🎭 {MAFIA_TEXT.labels.nightSecretCommands}</span>
          </div>

          <div className="panel" style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--neon-pink)', marginBottom: '8px', fontWeight: 'bold' }}>
              🌙 {MAFIA_TEXT.phases.night} — {MAFIA_TEXT.labels.nightSecretCommands}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span>{MAFIA_TEXT.roles.mafia}: {MAFIA_TEXT.actions.kill}</span>
              <span>{MAFIA_TEXT.roles.doctor}: {MAFIA_TEXT.actions.heal}</span>
              <span>{MAFIA_TEXT.roles.detective}: {MAFIA_TEXT.actions.investigate}</span>
            </div>
          </div>

          <div className="text-sm text-[var(--text-dim)] pt-2 border-t border-[var(--border-color)]">
            {MAFIA_TEXT.labels.rolesDmNote}
          </div>
        </div>
      </div>

      <MafiaDeadList deadPlayers={deadPlayers} />
    </div>
  );
}
