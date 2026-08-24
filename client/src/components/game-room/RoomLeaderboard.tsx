import { LeaderboardEntry } from '../../types/game';
import { PlayerAvatar } from '../PlayerAvatar';

interface RoomLeaderboardProps {
  /**
   * null = initial hydration in flight (show loading),
   * []   = hydrated but genuinely no scores yet (show empty).
   */
  entries: LeaderboardEntry[] | null;
}

const MEDALS = [
  { icon: '🥇', num: '#1', mod: 'gold' },
  { icon: '🥈', num: '#2', mod: 'silver' },
  { icon: '🥉', num: '#3', mod: 'bronze' },
];

/**
 * Phase 10B: read-only Game Room leaderboard.
 * Consumes the SAME global leaderboard state as the Control Panel —
 * no second state, no scoring logic, no admin controls. The board is
 * cross-game/all-time by design (Phase 9G semantics).
 */
export function RoomLeaderboard({ entries }: RoomLeaderboardProps) {
  // ---- Initial hydration ----
  if (entries === null) {
    return (
      <section className="panel players-panel rl-panel" aria-busy="true">
        <div className="pp-head">
          <span className="pp-title">المتصدرون</span>
        </div>
        <div className="rl-loading">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rl-skeleton" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
          <div className="text-center text-sm text-[var(--text-muted)]">جارٍ تحميل المتصدرين…</div>
        </div>
      </section>
    );
  }

  const board = [...entries].sort((a, b) => b.score - a.score);

  // ---- Empty ----
  if (board.length === 0) {
    return (
      <section className="panel players-panel rl-panel">
        <div className="pp-head">
          <span className="pp-title">المتصدرون</span>
          <span className="badge badge-yellow pp-count">🏆 إجمالي النقاط</span>
        </div>
        <div className="lobby-empty pp-empty">
          <div className="text-4xl mb-1">🏆</div>
          <div className="font-bold text-[var(--text-primary)]">لا توجد نقاط بعد</div>
          <div className="text-sm text-[var(--text-dim)] mt-1">
            العب عبر دردشة البث لتصبح أول المتصدرين!
          </div>
        </div>
      </section>
    );
  }

  const hasPodium = board.length >= 3;
  const top3 = board.slice(0, 3);
  const rest = board.slice(hasPodium ? 3 : 0);
  const podium = hasPodium ? [top3[1], top3[0], top3[2]] : [];

  return (
    <section className="panel players-panel rl-panel">
      <div className="pp-head">
        <span className="pp-title">المتصدرون</span>
        <span className="badge badge-yellow pp-count">🏆 إجمالي النقاط</span>
      </div>

      {hasPodium && (
        <div className="rl-podium">
          {[MEDALS[1], MEDALS[0], MEDALS[2]].map((medal, idx) => {
            const entry = podium[idx];
            if (!entry) return null;
            return (
              <div key={entry.playerId} className={`card rl-pod-card rl-${medal.mod} animate-fade-in`}>
                <span className={`rl-medal rl-medal--${medal.mod}`}>
                  <span aria-hidden="true">{medal.icon}</span>
                  <span className="rl-medal-num">{medal.num}</span>
                </span>
                <PlayerAvatar
                  id={entry.playerId}
                  name={entry.displayName}
                  avatarUrl={entry.avatarUrl}
                  size={idx === 1 ? 60 : 48}
                />
                <div className="pp-info">
                  <span className="pp-name" title={entry.displayName}>{entry.displayName}</span>
                  <span className={`rl-score ${medal.mod === 'gold' ? 'neon-text' : ''}`}>{entry.score}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rl-body">
        {!hasPodium &&
          board.map((entry, i) => (
            <div key={entry.playerId} className="rl-row animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
              <span className={`rl-rank rl-medal rl-medal--${MEDALS[i]?.mod ?? 'plain'}`}>{i + 1}</span>
              <PlayerAvatar id={entry.playerId} name={entry.displayName} avatarUrl={entry.avatarUrl} size={38} />
              <span className="pp-name">{entry.displayName}</span>
              <span className="rl-score ms-auto">{entry.score}</span>
            </div>
          ))}
        {rest.map((entry, i) => (
          <div key={entry.playerId} className="rl-row animate-fade-in" style={{ animationDelay: `${i * 50}ms` }}>
            <span className="rl-rank rl-medal rl-medal--plain">{i + 4}</span>
            <PlayerAvatar id={entry.playerId} name={entry.displayName} avatarUrl={entry.avatarUrl} size={38} />
            <span className="pp-name">{entry.displayName}</span>
            <span className="rl-score ms-auto">{entry.score}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
