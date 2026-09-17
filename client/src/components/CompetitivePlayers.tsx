import { PlayerAvatar } from './PlayerAvatar';
import { RankBadge } from './RankBadge';
import type { GameLeaderboardEntry } from '../types/competitive';

interface CompetitivePlayersProps {
  players: GameLeaderboardEntry[];
  loading?: boolean;
  error?: string | null;
}

/** 👥 اللاعبين — per-game competitive player cards. */
export function CompetitivePlayers({ players, loading, error }: CompetitivePlayersProps) {
  if (loading) {
    return (
      <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
        جارٍ تحميل اللاعبين…
      </div>
    );
  }
  if (error) {
    return <div className="panel text-center py-12 text-[var(--text-dim)]">{error}</div>;
  }
  if (players.length === 0) {
    return (
      <div className="panel text-center py-12 text-[var(--text-dim)]">
        لا يوجد لاعبون مصنّفون لهذه اللعبة حتى الآن — يظهر اللاعب هنا بعد أول مباراة تُعتمد نتيجتها.
      </div>
    );
  }

  return (
    <div className="competitive-players-grid">
      {players.map((p) => (
        <article key={p.playerId} className="card competitive-player-card text-right">
          <PlayerAvatar id={p.playerId} name={p.displayName ?? 'لاعب'} avatarUrl={p.avatarUrl ?? undefined} size={52} />
          <div className="competitive-player-card-info">
            <div className="competitive-player-card-name">{p.displayName ?? 'لاعب'}</div>
            <div className="competitive-player-card-rank">
              <RankBadge tierKey={p.rank.tierKey} label={p.rank.rankName} size={18} />
              <span className="badge badge-cyan">{p.rank.rankName}</span>
            </div>
            <dl className="competitive-player-card-stats">
              <div><dt>LP</dt><dd>{p.lp.toLocaleString('ar')}</dd></div>
              <div><dt>Elo</dt><dd>{p.elo.toLocaleString('ar')}</dd></div>
              <div><dt>ف / خ</dt><dd>{p.wins.toLocaleString('ar')} / {p.losses.toLocaleString('ar')}</dd></div>
            </dl>
          </div>
        </article>
      ))}
    </div>
  );
}
