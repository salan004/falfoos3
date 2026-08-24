import { MAFIA_TEXT, ROLE_COLORS } from '../mafia-text';
import { PlayerAvatar } from '../../../PlayerAvatar';

interface MafiaPlayerCardProps {
  player: {
    id: string;
    displayName: string;
    avatarUrl?: string;
    role: string;
    isAlive: boolean;
  };
}

export function MafiaPlayerCard({ player }: MafiaPlayerCardProps) {
  const roleVisible = player.role !== 'مجهول' && player.role !== '';
  const role = roleVisible ? player.role.toLowerCase() : '';
  const roleColor = roleVisible ? ROLE_COLORS[role] || 'var(--border-color)' : 'var(--border-color)';
  const roleLabel = roleVisible
    ? MAFIA_TEXT.roles[role as keyof typeof MAFIA_TEXT.roles] || player.role
    : 'مجهول';

  return (
    <div
      className="card"
      style={{
        textAlign: 'center',
        padding: '14px 12px',
        opacity: player.isAlive ? 1 : 0.55,
        borderColor: !player.isAlive && roleVisible ? roleColor : 'var(--border-color)',
        position: 'relative',
        minWidth: '132px',
        transition: 'transform 0.2s, box-shadow 0.2s',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <PlayerAvatar id={player.id} name={player.displayName} avatarUrl={player.avatarUrl} size={44} />
      <div style={{ fontSize: '0.85rem', fontWeight: 700 }} title={player.displayName}>
        {player.displayName}
      </div>
      <div style={{ fontSize: '0.72rem', color: roleVisible ? roleColor : 'var(--text-muted)', fontWeight: 600 }}>
        {roleLabel}
      </div>
      {!player.isAlive && (
        <div style={{
          position: 'absolute',
          top: '4px',
          right: '4px',
          fontSize: '0.65rem',
          color: 'var(--neon-red)',
          background: 'rgba(255,0,0,0.1)',
          padding: '2px 6px',
          borderRadius: '4px',
        }}>
          ⚰ ميت
        </div>
      )}
    </div>
  );
}
