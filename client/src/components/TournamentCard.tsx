import { TournamentWithGame, CompetitionType } from '../types/game';
import { resolveImageUrl } from '../utils/api';

type TournamentStatus = 'draft' | 'open' | 'active' | 'completed' | 'cancelled';

/** Roadmap #2 — compact competition-type label (secondary metadata). */
const COMPETITION_LABELS: Record<CompetitionType, string> = {
  individual: 'فردي',
  team_vs_team: 'فريق ضد فريق',
  two_vs_two: '2 ضد 2',
};

interface TournamentCardProps {
  tournament: TournamentWithGame;
  gameImageUrl?: string | null;
  onClick: () => void;
}

const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'مسودة',
  open: 'التسجيل مفتوح',
  active: 'جارية',
  completed: 'مكتملة',
  cancelled: 'ملغاة',
};

const STATUS_BADGE: Record<TournamentStatus, string> = {
  draft: 'badge-cyan',
  open: 'badge-green',
  active: 'badge-yellow',
  completed: 'badge-cyan',
  cancelled: 'badge-red',
};

export function TournamentCard({ tournament, gameImageUrl, onClick }: TournamentCardProps) {
  const statusLabel = STATUS_LABELS[tournament.status] || tournament.status;
  const badgeClass = STATUS_BADGE[tournament.status] || 'badge-cyan';
  const imageUrl = resolveImageUrl(tournament.image_url || gameImageUrl);

  return (
    <article
      className="card tournament-card text-right"
      style={{ '--card-accent': 'var(--neon-cyan)' } as React.CSSProperties}
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`${tournament.name_ar} — ${statusLabel}`}
    >
      <div className="tournament-card-image">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="tournament-card-placeholder">
            <span className="tournament-card-icon">🏆</span>
          </div>
        )}
        <span className={`badge ${badgeClass} tournament-status-badge`}>
          {statusLabel}
        </span>
      </div>

      <div className="tournament-card-content">
        <h3 className="tournament-card-title">{tournament.name_ar}</h3>
        {tournament.description_ar && (
          <p className="tournament-card-desc">{tournament.description_ar}</p>
        )}
        <div className="tournament-card-meta">
          {tournament.competition_type && tournament.competition_type !== 'individual' && (
            <span className="badge badge-cyan">
              ⚔️ {COMPETITION_LABELS[tournament.competition_type]}
            </span>
          )}
          <span className="badge badge-yellow">
            👥 {(tournament.participant_count ?? 0).toLocaleString('ar')}
            {tournament.max_participants ? ` / ${tournament.max_participants.toLocaleString('ar')}` : ''}
          </span>
          {tournament.starts_at && (
            <span className="badge badge-cyan">
              📅 {new Date(tournament.starts_at).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}