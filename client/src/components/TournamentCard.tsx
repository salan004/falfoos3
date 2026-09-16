import { TournamentWithGame } from '../types/game';

type TournamentStatus = 'draft' | 'open' | 'active' | 'completed' | 'cancelled';

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
  const imageUrl = tournament.image_url || gameImageUrl;

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
          {tournament.max_participants && (
            <span className="badge badge-yellow">
              👥 {tournament.participant_count ?? 0} / {tournament.max_participants}
            </span>
          )}
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