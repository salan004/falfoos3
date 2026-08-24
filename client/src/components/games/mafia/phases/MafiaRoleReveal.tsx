import type { MafiaPhaseWindow, MafiaRolesSummary } from '../hooks/useMafiaLiveEvents';
import { MafiaPhaseTimer } from '../components/MafiaPhaseTimer';
import { MAFIA_TEXT } from '../mafia-text';

interface MafiaRoleRevealProps {
  rolesSummary: MafiaRolesSummary | null;
  activeWindow: MafiaPhaseWindow | null;
}

export function MafiaRoleReveal({ rolesSummary, activeWindow }: MafiaRoleRevealProps) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '24px',
        animation: 'fade-in 0.5s ease-out',
      }}
    >
      <div className="text-2xl font-extrabold text-[var(--neon-pink)] animate-pulse">
        🎭 {MAFIA_TEXT.phases.roleReveal}
      </div>

      <div
        className="card text-center"
        style={{
          padding: '32px',
          borderColor: 'var(--neon-purple)',
          boxShadow: '0 0 30px var(--neon-purple)50',
          maxWidth: '420px',
          width: '100%',
        }}
      >
        {rolesSummary ? (
          <div className="flex justify-center gap-2 flex-wrap mb-4">
            <span className="badge badge-cyan text-sm">👥 {rolesSummary.playerCount} لاعبين</span>
            <span className="badge badge-red text-sm">
              🗡️ {MAFIA_TEXT.roles.mafia}: {rolesSummary.mafiaCount}
            </span>
            {rolesSummary.hasDoctor && (
              <span className="badge badge-green text-sm">🩺 {MAFIA_TEXT.roles.doctor}</span>
            )}
            {rolesSummary.hasDetective && (
              <span className="badge badge-cyan text-sm">🔍 {MAFIA_TEXT.roles.detective}</span>
            )}
          </div>
        ) : null}

        <div className="text-sm text-[var(--text-dim)]" style={{ lineHeight: '1.6' }}>
          {MAFIA_TEXT.labels.rolesDmNote}
        </div>

        {activeWindow && (
          <div className="mt-5">
            <MafiaPhaseTimer window={activeWindow} />
          </div>
        )}
      </div>
    </div>
  );
}
