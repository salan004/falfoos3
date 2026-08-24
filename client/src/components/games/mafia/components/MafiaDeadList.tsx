import { MAFIA_TEXT, ROLE_COLORS } from '../mafia-text';

interface MafiaDeadListProps {
  deadPlayers: { id: string; displayName: string; role: string; isAlive: boolean }[];
}

export function MafiaDeadList({ deadPlayers }: MafiaDeadListProps) {
  if (deadPlayers.length === 0) return null;

  return (
    <div className="panel" style={{ marginTop: '8px' }}>
      <div className="text-sm text-[var(--text-muted)] mb-2 text-center">
        💀 {MAFIA_TEXT.labels.eliminatedPlayers}
      </div>
      <div className="flex flex-wrap gap-2 justify-center">
        {deadPlayers.map((player) => {
          const role = player.role.toLowerCase();
          const color = ROLE_COLORS[role] || 'var(--border-color)';
          return (
            <span
              key={player.id}
              className="badge text-sm"
              style={{ 
                borderColor: color,
                color: color,
                background: `${color}15`,
              }}
            >
              {player.displayName} ({MAFIA_TEXT.roles[role as keyof typeof MAFIA_TEXT.roles] || player.role})
            </span>
          );
        })}
      </div>
    </div>
  );
}