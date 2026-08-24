import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MafiaVoteStatus } from '../components/MafiaVoteStatus';
import { MafiaDeadList } from '../components/MafiaDeadList';
import { MAFIA_TEXT } from '../mafia-text';
import type { MafiaGameState } from '../../../../types/game';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';

interface MafiaVotingProps {
  state: MafiaGameState;
  timerWindow: MafiaPhaseWindow | null;
}

export function MafiaVoting({ state, timerWindow }: MafiaVotingProps) {
  const deadPlayers = state.players.filter((p) => !p.isAlive);
  const aliveCount = typeof state.aliveCount === 'number'
    ? state.aliveCount
    : state.players.filter((p) => p.isAlive).length;
  const votedCount = typeof state.votedCount === 'number' ? state.votedCount : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-yellow text-lg">🗳️ {MAFIA_TEXT.phases.voting} {state.round}</span>
        </div>
        <MafiaPhaseTimer window={timerWindow} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', flex: 1, overflow: 'auto' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-yellow">🗳️ {MAFIA_TEXT.phases.voting}</span>
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
            <span className="badge badge-yellow">🗳️ تصويتك</span>
          </div>

          <MafiaVoteStatus votedCount={votedCount} aliveCount={aliveCount} />
        </div>
      </div>

      <MafiaDeadList deadPlayers={deadPlayers} />
    </div>
  );
}
