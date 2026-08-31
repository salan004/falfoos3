import { useState } from 'react';
import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MafiaVoteStatus } from '../components/MafiaVoteStatus';
import { MafiaDeadList } from '../components/MafiaDeadList';
import { MAFIA_TEXT } from '../mafia-text';
import { sendMafiaVote } from '../../../../utils/socket';
import type { MafiaGameState } from '../../../../types/game';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';

interface MafiaVotingProps {
  state: MafiaGameState;
  timerWindow: MafiaPhaseWindow | null;
  currentPlayerId: string | null;
}

export function MafiaVoting({ state, timerWindow, currentPlayerId }: MafiaVotingProps) {
  const players = state.players ?? [];
  const deadPlayers = players.filter((p) => !p.isAlive);
  const aliveCount = typeof state.aliveCount === 'number'
    ? state.aliveCount
    : players.filter((p) => p.isAlive).length;
  const votedCount = typeof state.votedCount === 'number' ? state.votedCount : 0;

  // Find the current player in the game
  const currentPlayer = currentPlayerId ? players.find((p) => p.id === currentPlayerId) : null;
  const isPlayerInGame = !!currentPlayer;
  const isAlive = currentPlayer?.isAlive ?? false;
  const canVote = isPlayerInGame && isAlive && !state.nightPhase;

  // Track if vote has been submitted to prevent duplicate submissions
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const alivePlayers = players.filter((p) => p.isAlive && p.id !== currentPlayerId);

  const handleVote = (targetId: string) => {
    if (!canVote || voteSubmitted) return;
    setVoteSubmitted(true);
    setSelectedTarget(targetId);
    sendMafiaVote(targetId);
  };

  const renderVoteControls = () => {
    if (!isPlayerInGame) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--text-muted)]">
            {MAFIA_TEXT.labels.rolesDmNote}
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-2">
            التصويت يتطلب فتح موقع فلفوس وتسجيل الدخول.
          </div>
        </div>
      );
    }

    if (!isAlive) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--neon-red)] font-bold">
            ⚰️ أنت ميت — لا يمكنك التصويت.
          </div>
        </div>
      );
    }

    if (state.nightPhase) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--text-muted)]">
            ليس وقت التصويت حالياً.
          </div>
        </div>
      );
    }

    if (voteSubmitted) {
      const targetName = players.find((p) => p.id === selectedTarget)?.displayName ?? 'هدف';
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px', borderColor: 'var(--neon-green)' }}>
          <div className="text-sm text-[var(--neon-green)] font-bold mb-2">
            ✅ تم إرسال التصويت
          </div>
          <div className="text-xs text-[var(--text-dim)]">
            {MAFIA_TEXT.messages.voteRecorded(targetName)}
          </div>
        </div>
      );
    }

    return (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="flex items-center gap-2">
          <span className="badge badge-yellow">🗳️ تصويتك</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '6px' }}>
          {alivePlayers.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => handleVote(target.id)}
              disabled={voteSubmitted}
              className="card"
              style={{
                padding: '10px 8px',
                textAlign: 'center',
                cursor: voteSubmitted ? 'not-allowed' : 'pointer',
                opacity: voteSubmitted ? 0.6 : 1,
                borderColor: selectedTarget === target.id ? 'var(--neon-yellow)' : 'var(--border-color)',
                background: selectedTarget === target.id ? 'rgba(255,221,0,0.1)' : 'transparent',
                transition: 'all 0.15s',
                minHeight: '72px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 700 }} title={target.displayName}>
                {target.displayName}
              </span>
              <span style={{ fontSize: '0.65rem', color: 'var(--neon-yellow)', fontWeight: 600 }}>
                تصويت
              </span>
            </button>
          ))}
        </div>

        {alivePlayers.length === 0 && (
          <div className="text-xs text-[var(--text-dim)] text-center pt-2">
            لا يوجد مرشحون متاحون.
          </div>
        )}

        <MafiaVoteStatus votedCount={votedCount} aliveCount={aliveCount} />
      </div>
    );
  };

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
            {players.map((p) => (
              <MafiaPlayerCard key={p.id} player={p} />
            ))}
          </div>

          <div className="text-sm text-[var(--text-muted)] text-center pt-2 border-t border-[var(--border-color)]">
            {MAFIA_TEXT.labels.roundLabel} {state.round}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {renderVoteControls()}
        </div>
      </div>

      <MafiaDeadList deadPlayers={deadPlayers} />
    </div>
  );
}
