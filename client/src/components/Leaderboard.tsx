import { LeaderboardEntry } from '../types/game';

interface LeaderboardProps {
  entries: LeaderboardEntry[];
}

export function Leaderboard({ entries }: LeaderboardProps) {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);

  const podiumItems = [
    { entry: top3[1], height: 'h-16', rank: 2, label: '#2' },
    { entry: top3[0], height: 'h-24', rank: 1, label: '👑' },
    { entry: top3[2], height: 'h-12', rank: 3, label: '#3' },
  ];

  return (
    <div className="panel max-h-[350px] overflow-auto">
      <div className="text-[0.7rem] text-[var(--text-muted)] mb-2 uppercase tracking-wider">
        🏆 المتصدرون
      </div>

      {entries.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-3">
          لا توجد نقاط بعد
        </div>
      )}

      {top3.length === 3 && (
        <div className="flex items-end justify-center gap-3 mb-4 mt-2">
          {podiumItems.map((item) =>
            item.entry ? (
              <div key={item.rank} className="flex flex-col items-center gap-1">
                <div className={item.rank === 1 ? 'text-lg animate-pulse' : 'text-base'}>
                  {item.label}
                </div>
                <div
                  className={`${item.height} w-20 rounded-t-lg flex flex-col items-center justify-end pb-2 px-1 border-t-2 border-x-2`}
                  style={{
                    background:
                      item.rank === 1
                        ? 'linear-gradient(180deg, rgba(255,221,0,0.15), rgba(255,221,0,0.05))'
                        : item.rank === 2
                        ? 'linear-gradient(180deg, rgba(96,96,128,0.15), rgba(96,96,128,0.05))'
                        : 'linear-gradient(180deg, rgba(205,127,50,0.15), rgba(205,127,50,0.05))',
                    borderColor:
                      item.rank === 1
                        ? 'var(--neon-yellow)'
                        : item.rank === 2
                        ? 'var(--text-dim)'
                        : '#cd7f32',
                    boxShadow:
                      item.rank === 1
                        ? '0 -4px 20px rgba(255,221,0,0.2)'
                        : 'none',
                  }}
                >
                  <div className="text-[0.7rem] font-bold text-center leading-tight truncate w-full">
                    {item.entry.displayName}
                  </div>
                  <div
                    className={`text-xs font-bold mt-0.5 ${
                      item.rank === 1 ? 'neon-text' : 'text-[var(--text-dim)]'
                    }`}
                  >
                    {item.entry.score}
                  </div>
                </div>
              </div>
            ) : null
          )}
        </div>
      )}

      {top3.length === 3 && (
        <div className="border-t border-[var(--border-color)] pt-2 space-y-1">
          {rest.map((entry, i) => (
            <div
              key={entry.playerId}
              className="flex justify-between items-center px-2 py-1 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-muted)] font-bold w-5">
                  #{i + 4}
                </span>
                <span className="text-[var(--text-primary)]">{entry.displayName}</span>
              </div>
              <span className="text-[var(--neon-cyan)] font-bold">{entry.score}</span>
            </div>
          ))}
        </div>
      )}

      {top3.length < 3 && top3.length > 0 && (
        <div className="space-y-1">
          {entries.map((entry, i) => (
            <div
              key={entry.playerId}
              className="card flex justify-between items-center mb-1"
              style={{
                borderColor:
                  i === 0
                    ? 'var(--neon-yellow)'
                    : i === 1
                    ? 'var(--text-dim)'
                    : 'var(--neon-cyan)',
              }}
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold w-5 text-center">#{i + 1}</span>
                <span className="text-sm font-semibold">{entry.displayName}</span>
              </div>
              <span className="neon-text font-bold">{entry.score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
