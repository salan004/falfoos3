import { MAFIA_TEXT } from '../mafia-text';

interface MafiaVoteStatusProps {
  votedCount: number;
  aliveCount: number;
}

export function MafiaVoteStatus({ votedCount, aliveCount }: MafiaVoteStatusProps) {
  const safeAlive = Math.max(0, aliveCount);
  const safeVoted = Math.max(0, Math.min(votedCount, safeAlive));
  const percent = safeAlive > 0 ? (safeVoted / safeAlive) * 100 : 0;
  const complete = safeAlive > 0 && safeVoted >= safeAlive;

  return (
    <div className="panel" style={{ marginTop: '8px', borderColor: 'var(--neon-yellow)' }}>
      <div className="text-sm text-[var(--neon-yellow)] font-bold mb-2">
        🗳️ مرحلة التصويت
      </div>
      <div className="text-sm text-[var(--text-dim)] mb-2">
        {safeVoted} / {safeAlive} لاعبين صوّتوا{complete ? ' — اكتمل التصويت' : ''}
      </div>
      <div
        className="h-2 bg-[var(--bg-card)] rounded-full overflow-hidden"
        style={{ border: '1px solid var(--border-color)' }}
      >
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: `${percent}%`,
            background: 'var(--neon-yellow)',
            boxShadow: '0 0 10px var(--neon-yellow)',
          }}
        />
      </div>
      <div className="text-xs text-[var(--text-dim)] mt-3">
        اكتب <span className="text-neon-yellow font-bold">{MAFIA_TEXT.actions.vote}</span> للتصويت
      </div>
    </div>
  );
}
