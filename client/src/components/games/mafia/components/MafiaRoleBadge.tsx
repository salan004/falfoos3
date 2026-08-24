import { ROLE_COLORS, MAFIA_TEXT } from '../mafia-text';

interface MafiaRoleBadgeProps {
  role: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
}

export function MafiaRoleBadge({ role, size = 'md', showIcon = true }: MafiaRoleBadgeProps) {
  const normalizedRole = role.toLowerCase();
  const color = ROLE_COLORS[normalizedRole] || 'var(--border-color)';
  const label = MAFIA_TEXT.roles[normalizedRole as keyof typeof MAFIA_TEXT.roles] || role;

  const icons: Record<string, string> = {
    mafia: '🗡️',
    doctor: '🩺',
    detective: '🔍',
    citizen: '👤',
  };

  const sizeStyles = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`badge inline-flex items-center gap-1 ${sizeStyles[size]}`}
      style={{ 
        borderColor: color,
        color: color,
        background: `${color}15`,
      }}
    >
      {showIcon && icons[normalizedRole] && <span>{icons[normalizedRole]}</span>}
      <span>{MAFIA_TEXT.roles[normalizedRole as keyof typeof MAFIA_TEXT.roles] || role}</span>
    </span>
  );
}