import type { GameLeaderboardEntry } from '../types/competitive';
import { RankBadge } from './RankBadge';
import { rankBadgeAsset } from '../data/rankBadges';

interface CompetitiveRankingsProps {
  players: GameLeaderboardEntry[];
  loading?: boolean;
  error?: string | null;
}

const TIER_ORDER = ['legendary', 'diamond', 'platinum', 'gold', 'silver', 'bronze'] as const;

const TIER_LABELS: Record<string, string> = {
  legendary: 'أسطوري',
  diamond: 'ماسي',
  platinum: 'بلاتيني',
  gold: 'ذهبي',
  silver: 'فضي',
  bronze: 'برونزي',
};

/** 📊 التصنيف — the game's competitive ranking overview (rank/LP/Elo/W-L). */
export function CompetitiveRankings({ players, loading, error }: CompetitiveRankingsProps) {
  if (loading) {
    return (
      <div className="panel text-center py-12 loading-pulse text-[var(--text-dim)]">
        جارٍ تحميل التصنيف…
      </div>
    );
  }
  if (error) {
    return <div className="panel text-center py-12 text-[var(--text-dim)]">{error}</div>;
  }
  if (players.length === 0) {
    return (
      <div className="panel text-center py-12 text-[var(--text-dim)]">
        لا توجد نتائج تصنيف حتى الآن — يبدأ التصنيف بعد أول مباراة تُعتمد نتيجتها.
      </div>
    );
  }

  const distribution = new Map<string, number>();
  let matches = 0;
  let wins = 0;
  let losses = 0;
  let draws = 0;
  for (const p of players) {
    distribution.set(p.rank.tierKey, (distribution.get(p.rank.tierKey) ?? 0) + 1);
    matches += p.matchesPlayed;
    wins += p.wins;
    losses += p.losses;
    draws += p.draws;
  }

  const trueTiers = [...distribution.entries()]
    .filter(([tier, count]) => count > 0 && (TIER_ORDER as readonly string[]).includes(tier))
    .sort((a, b) => TIER_ORDER.indexOf(a[0] as (typeof TIER_ORDER)[number]) - TIER_ORDER.indexOf(b[0] as (typeof TIER_ORDER)[number]));

  const maxCount = Math.max(1, ...trueTiers.map(([, count]) => count));

  return (
    <div className="competitive-rankings">
      <div className="competitive-stats-row">
        <div className="panel competitive-stat-card">
          <div className="competitive-stat-value">{players.length.toLocaleString('ar')}</div>
          <div className="competitive-stat-label">لاعب مصنّف</div>
        </div>
        <div className="panel competitive-stat-card">
          <div className="competitive-stat-value">{matches.toLocaleString('ar')}</div>
          <div className="competitive-stat-label">مباريات</div>
        </div>
        <div className="panel competitive-stat-card">
          <div className="competitive-stat-value">{wins.toLocaleString('ar')}</div>
          <div className="competitive-stat-label">انتصارات</div>
        </div>
        <div className="panel competitive-stat-card">
          <div className="competitive-stat-value">{losses.toLocaleString('ar')}</div>
          <div className="competitive-stat-label">خسائر</div>
        </div>
        <div className="panel competitive-stat-card">
          <div className="competitive-stat-value">{draws.toLocaleString('ar')}</div>
          <div className="competitive-stat-label">تعادلات</div>
        </div>
      </div>

      <div className="panel">
        <h3 className="section-title" style={{ fontSize: '1.05rem', marginBottom: 14 }}>توزيع الرتب</h3>
        <div className="rank-distribution">
          {trueTiers.map(([tier, count]) => (
            <div key={tier} className="rank-distribution-row">
              <RankBadge tierKey={tier} label={TIER_LABELS[tier] ?? tier} size={18} />
              {rankBadgeAsset(tier) ? null : (
                <span className={`rank-tier-dot rank-tier-${tier}`} aria-hidden="true" />
              )}
              <span className="rank-distribution-label">{TIER_LABELS[tier] ?? tier}</span>
              <span className="rank-distribution-bar" aria-hidden="true">
                <span
                  className={`rank-distribution-fill rank-tier-bg-${tier}`}
                  style={{ width: `${Math.round((count / maxCount) * 100)}%` }}
                />
              </span>
              <span className="rank-distribution-count">{count.toLocaleString('ar')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel competitive-note">
        <p>
          <strong>LP</strong> (نقاط التصنيف) تُحدّد رتبتك، و<strong>Elo</strong> يقيس مستوى قدرتك التنافسية،
          وكلاهما مستقل عن نظام نقاط الفلفوس العام.
        </p>
      </div>
    </div>
  );
}
