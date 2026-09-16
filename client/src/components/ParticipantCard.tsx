import { ParticipantWithProfile } from '../types/game';

interface ParticipantCardProps {
  participant: ParticipantWithProfile;
  index?: number;
}

export function ParticipantCard({ participant, index }: ParticipantCardProps) {
  return (
    <article className="card participant-card text-right" dir="rtl">
      <div className="participant-card-avatar">
        {participant.youtube_avatar_url ? (
          <img
            src={participant.youtube_avatar_url}
            alt={participant.youtube_name || 'YouTube avatar'}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="participant-card-avatar-placeholder">
            {participant.youtube_name?.charAt(0) || '؟'}
          </div>
        )}
      </div>
      <div className="participant-card-info">
        <span className="participant-card-name">{participant.youtube_name || 'قناة يوتيوب'}</span>
        <span className="participant-card-meta">
          {participant.source === 'purchase' && '🎫 تذكرة'}
          {participant.source === 'admin' && '👑 إدارة'}
          {participant.source === 'qualifier' && '⭐ تأهيل'}
        </span>
      </div>
      {index !== undefined && (
        <span className="participant-card-index">#{index + 1}</span>
      )}
    </article>
  );
}