import { MAFIA_TEXT } from '../mafia-text';
import type { MafiaVotingResultSnapshot } from '../../../../types/game';

interface MafiaVoteResultProps {
  snapshot: MafiaVotingResultSnapshot;
}

export function MafiaVoteResult({ snapshot }: MafiaVoteResultProps) {
  const maxVotes = Math.max(1, ...snapshot.votes.map((v) => v.votes));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-yellow text-lg">⚖️ {MAFIA_TEXT.phases.voteResult}</span>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'auto' }}>
        <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="flex items-center gap-2">
            <span className="badge badge-yellow">⚖️ نتيجة التصويت</span>
          </div>

          {snapshot.tie ? (
            <div className="panel text-center" style={{ borderColor: 'var(--neon-yellow)', background: 'rgba(255,221,0,0.05)' }}>
              <div className="text-lg text-[var(--neon-yellow)] font-bold mb-2">⚖️ {MAFIA_TEXT.messages.voteTie}</div>
              {snapshot.message && (
                <div className="text-sm text-[var(--text-dim)]">{snapshot.message}</div>
              )}
            </div>
          ) : snapshot.eliminated ? (
            <div className="panel" style={{ borderColor: 'var(--neon-red)', background: 'rgba(255,51,85,0.05)' }}>
              <div className="text-base font-bold text-[var(--neon-red)]">
                💀 {MAFIA_TEXT.messages.voteResult(snapshot.eliminated)}
              </div>
              {snapshot.message && (
                <div className="text-sm text-[var(--text-dim)] mt-1">{snapshot.message}</div>
              )}
            </div>
          ) : (
            <div className="panel text-center" style={{ borderColor: 'var(--neon-yellow)', background: 'rgba(255,221,0,0.05)' }}>
              <div className="text-lg text-[var(--neon-yellow)] font-bold">{MAFIA_TEXT.messages.voteTie}</div>
            </div>
          )}

          {snapshot.votes.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-color)]">
              <div className="text-sm text-[var(--text-muted)] mb-2">تفاصيل الأصوات:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {snapshot.votes.map((tally) => {
                  const percentage = Math.min(100, (tally.votes / maxVotes) * 100);
                  const isEliminated = !snapshot.tie && tally.playerName === snapshot.eliminated;
                  return (
                    <div key={tally.playerId} className="flex items-center justify-between text-sm">
                      <span className="text-[var(--text-primary)]">{tally.playerName}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-muted)]">{tally.votes} صوت</span>
                        <div className="h-2 bg-[var(--border-color)] rounded-full flex-1 max-w-[100px] overflow-hidden">
                          <div
                            className="h-full transition-all duration-500 ease-out"
                            style={{
                              width: `${percentage}%`,
                              background: isEliminated ? 'var(--neon-red)' : 'var(--neon-cyan)',
                              boxShadow: isEliminated ? '0 0 10px var(--neon-red)' : '0 0 10px var(--neon-cyan)',
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
