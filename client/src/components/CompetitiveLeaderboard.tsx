import { PlayerAvatar } from './PlayerAvatar';
import { RankBadge } from './RankBadge';
import type { GameLeaderboardEntry } from '../types/competitive';

interface CompetitiveLeaderboardProps {
  players: GameLeaderboardEntry[];
  loading?: boolean;
  error?: string | null;
}

/** 🥇 المتصدرين — per-game competitive table (LP / Elo / rank). */
export function CompetitiveLeaderboard({ players, loading, error }: CompetitiveLeaderboardProps) {
  if (loading) {
    return (
      <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
        جارٍ تحميل المتصدرين…
      </div>
    );
  }
  if (error) {
    return <div className="panel text-center py-12 text-[var(--text-dim)]">{error}</div>;
  }
  if (players.length === 0) {
    return (
      <div className="panel text-center py-12 text-[var(--text-dim)]">
        لا يوجد متصدرون لهذه اللعبة حتى الآن — تُبنى لوحة المتصدرين من نتائج المباريات المعتمدة (LP و Elo).
      </div>
    );
  }

  return (
    <div className="competitive-leaderboard">
      <p className="competitive-note" style={{ marginTop: 0, marginBottom: 12 }}>
        الترتيب حسب <strong>LP</strong> (نقاط التصنيف) ثم <strong>Elo</strong> — وكلاهما مستقل عن التسجيل،
        ولا يتغيّر إلا بنتائج المباريات المعتمدة.
      </p>
      <div className="panel competitive-table-wrap">
        <table className="competitive-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">اللاعب</th>
              <th scope="col">الرتبة</th>
              <th scope="col">LP</th>
              <th scope="col">Elo</th>
              <th scope="col">ف / خ</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.playerId} className={p.position <= 3 ? `competitive-row-top competitive-row-${p.position}` : undefined}>
                <td className="competitive-pos">{p.position.toLocaleString('ar')}</td>
                <td>
                  <div className="competitive-player">
                    <PlayerAvatar id={p.playerId} name={p.displayName ?? 'لاعب'} avatarUrl={p.avatarUrl ?? undefined} size={34} />
                    <RankBadge tierKey={p.rank.tierKey} label={p.rank.rankName} size={18} />
                    <span className="competitive-player-name">{p.displayName ?? 'لاعب'}</span>
                  </div>
                </td>
                <td>
                  <span className="badge badge-cyan">{p.rank.rankName}</span>
                </td>
                <td className="competitive-num">{p.lp.toLocaleString('ar')}</td>
                <td className="competitive-num">{p.elo.toLocaleString('ar')}</td>
                <td className="competitive-num">
                  {p.wins.toLocaleString('ar')} / {p.losses.toLocaleString('ar')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
