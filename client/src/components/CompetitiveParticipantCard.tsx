import { PlayerAvatar } from './PlayerAvatar';
import type { CompetitiveRosterEntry, GameLeaderboardEntry } from '../types/competitive';

interface CompetitiveParticipantCardProps {
  entry: CompetitiveRosterEntry;
  profile?: GameLeaderboardEntry;
  wins: number;
  losses: number;
  index?: number;
  onClick?: () => void;
}

/** Tournament participant tile with competitive identity (rank / LP / Elo / W-L). */
export function CompetitiveParticipantCard({
  entry,
  profile,
  wins,
  losses,
  index,
  onClick,
}: CompetitiveParticipantCardProps) {
  const name = entry.displayName ?? profile?.displayName ?? 'لاعب';
  const interactive = typeof onClick === 'function';

  return (
    <article
      className={`card competitive-participant-card text-right ${entry.champion ? 'is-champion' : ''} ${
        entry.eliminated ? 'is-eliminated' : ''
      }`}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="competitive-participant-top">
        <PlayerAvatar id={entry.playerId} name={name} avatarUrl={entry.avatarUrl ?? profile?.avatarUrl ?? undefined} size={52} />
        <div className="competitive-participant-head">
          <span className="competitive-participant-name">{name}</span>
          <div className="competitive-participant-badges">
            {entry.champion && <span className="badge badge-gold">🏆 البطل</span>}
            {!entry.champion && entry.eliminated && <span className="badge badge-red">مُقصى</span>}
            {!entry.champion && !entry.eliminated && entry.advanced && <span className="badge badge-green">متأهل</span>}
            {typeof entry.seed === 'number' && <span className="badge badge-cyan">Seed #{entry.seed.toLocaleString('ar')}</span>}
          </div>
        </div>
        {typeof index === 'number' && <span className="participant-card-index">#{index + 1}</span>}
      </div>

      <dl className="competitive-participant-stats">
        <div>
          <dt>الرتبة</dt>
          <dd>{profile?.rank.rankName ?? '—'}</dd>
        </div>
        <div>
          <dt>LP</dt>
          <dd>{typeof profile?.lp === 'number' ? profile.lp.toLocaleString('ar') : '—'}</dd>
        </div>
        <div>
          <dt>Elo</dt>
          <dd>{typeof profile?.elo === 'number' ? profile.elo.toLocaleString('ar') : '—'}</dd>
        </div>
        <div>
          <dt>ف / خ</dt>
          <dd>
            {wins.toLocaleString('ar')} / {losses.toLocaleString('ar')}
          </dd>
        </div>
      </dl>
    </article>
  );
}
