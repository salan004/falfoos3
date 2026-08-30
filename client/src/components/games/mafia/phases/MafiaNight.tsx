import { useState } from 'react';
import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MafiaDeadList } from '../components/MafiaDeadList';
import { MAFIA_TEXT, ROLE_COLORS } from '../mafia-text';
import { sendMafiaNightAction } from '../../../../utils/socket';
import type { MafiaGameState } from '../../../../types/game';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';

interface MafiaNightProps {
  state: MafiaGameState;
  timerWindow: MafiaPhaseWindow | null;
  currentPlayerId: string | null;
}

export function MafiaNight({ state, timerWindow, currentPlayerId }: MafiaNightProps) {
  const players = state.players ?? [];
  const deadPlayers = players.filter((p) => !p.isAlive);
  const aliveCount = typeof state.aliveCount === 'number'
    ? state.aliveCount
    : players.filter((p) => p.isAlive).length;

  // Find the current player in the game
  const currentPlayer = currentPlayerId ? players.find((p) => p.id === currentPlayerId) : null;
  const isPlayerInGame = !!currentPlayer;
  const isAlive = currentPlayer?.isAlive ?? false;
  const playerRole = currentPlayer?.role?.toLowerCase() ?? '';
  const canAct = isPlayerInGame && isAlive && state.nightPhase;

  // Track if action has been submitted to prevent duplicate submissions
  const [actionSubmitted, setActionSubmitted] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);

  const alivePlayers = players.filter((p) => p.isAlive && p.id !== currentPlayerId);

  const handleAction = (action: 'kill' | 'heal' | 'investigate', targetId: string) => {
    if (!canAct || actionSubmitted) return;
    setActionSubmitted(true);
    setSelectedTarget(targetId);
    sendMafiaNightAction(action, targetId);
  };

  const renderActionControls = () => {
    if (!isPlayerInGame) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--text-muted)]">
            {MAFIA_TEXT.labels.rolesDmNote}
          </div>
          <div className="text-xs text-[var(--text-dim)] mt-2">
            الإجراءات السرية تتطلب فتح موقع فلفوس وتسجيل الدخول.
          </div>
        </div>
      );
    }

    if (!isAlive) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--neon-red)] font-bold">
            ⚰️ أنت ميت — لا يمكنك تنفيذ إجراءات ليلية.
          </div>
        </div>
      );
    }

    if (!state.nightPhase) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--text-muted)]">
            ليس وقت الإجراءات الليلية حالياً.
          </div>
        </div>
      );
    }

    if (actionSubmitted) {
      const targetName = players.find((p) => p.id === selectedTarget)?.displayName ?? 'هدف';
      const actionLabel = playerRole === 'mafia' ? 'قتل' : playerRole === 'doctor' ? 'شفاء' : 'تحقيق';
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px', borderColor: 'var(--neon-green)' }}>
          <div className="text-sm text-[var(--neon-green)] font-bold mb-2">
            ✅ تم إرسال الإجراء
          </div>
          <div className="text-xs text-[var(--text-dim)]">
            {MAFIA_TEXT.messages.nightActionRecorded(actionLabel, targetName)}
          </div>
        </div>
      );
    }

    // Determine valid action based on role
    const validActions: { type: 'kill' | 'heal' | 'investigate'; label: string }[] = [];
    if (playerRole === 'mafia') validActions.push({ type: 'kill', label: 'قتل' });
    if (playerRole === 'doctor') validActions.push({ type: 'heal', label: 'شفاء' });
    if (playerRole === 'detective') validActions.push({ type: 'investigate', label: 'تحقيق' });

    if (validActions.length === 0) {
      return (
        <div className="panel" style={{ textAlign: 'center', padding: '16px' }}>
          <div className="text-sm text-[var(--text-muted)]">
            دورك (مواطن) لا يملك إجراءات ليلية.
          </div>
        </div>
      );
    }

    return (
      <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="flex items-center gap-2">
          <span className="badge" style={{ background: ROLE_COLORS[playerRole] || 'var(--border-color)', color: 'var(--bg-dark)' }}>
            دورك: {MAFIA_TEXT.roles[playerRole as keyof typeof MAFIA_TEXT.roles] || playerRole}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '6px' }}>
          {alivePlayers.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => handleAction(validActions[0].type, target.id)}
              disabled={actionSubmitted}
              className="card"
              style={{
                padding: '10px 8px',
                textAlign: 'center',
                cursor: actionSubmitted ? 'not-allowed' : 'pointer',
                opacity: actionSubmitted ? 0.6 : 1,
                borderColor: selectedTarget === target.id ? (ROLE_COLORS[playerRole] || 'var(--neon-cyan)') : 'var(--border-color)',
                background: selectedTarget === target.id ? `rgba(${ROLE_COLORS[playerRole]?.replace('var(--', '').replace(')', '') || '0,255,200'}, 0.1)` : 'transparent',
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
              <span style={{ fontSize: '0.65rem', color: ROLE_COLORS[playerRole] || 'var(--neon-cyan)', fontWeight: 600 }}>
                {validActions[0].label}
              </span>
            </button>
          ))}
        </div>

        {alivePlayers.length === 0 && (
          <div className="text-xs text-[var(--text-dim)] text-center pt-2">
            لا يوجد أهداف متاحة.
          </div>
        )}
      </div>
    );
  };

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
            {players.map((p) => (
              <MafiaPlayerCard key={p.id} player={p} />
            ))}
          </div>

          <div className="text-sm text-[var(--text-muted)] text-center pt-2 border-t border-[var(--border-color)]">
            {MAFIA_TEXT.labels.roundLabel} {state.round}
          </div>
        </div>

        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {renderActionControls()}
        </div>
      </div>

      <MafiaDeadList deadPlayers={deadPlayers} />
    </div>
  );
}
