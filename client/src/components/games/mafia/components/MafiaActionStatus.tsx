import { MAFIA_TEXT } from '../mafia-text';

interface MafiaActionStatusProps {
  role: string;
  confirmedActionText?: string;
}

const NIGHT_ACTION_HINTS: Record<string, string> = {
  mafia: MAFIA_TEXT.actions.kill,
  doctor: MAFIA_TEXT.actions.heal,
  detective: MAFIA_TEXT.actions.investigate,
};

export function MafiaActionStatus({ role, confirmedActionText }: MafiaActionStatusProps) {
  const hint = NIGHT_ACTION_HINTS[role.toLowerCase()] ?? MAFIA_TEXT.labels.noNightAction;

  if (confirmedActionText) {
    return (
      <div className="panel" style={{ marginTop: '8px', borderColor: 'var(--neon-green)' }}>
        <div className="text-sm text-[var(--neon-green)] font-bold mb-2">
          ✅ {MAFIA_TEXT.labels.actionConfirmed}
        </div>
        <div className="text-sm text-[var(--text-dim)]">
          {confirmedActionText}
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginTop: '8px', borderColor: 'var(--neon-pink)' }}>
      <div className="text-sm text-[var(--neon-pink)] font-bold mb-2">
        🌙 {MAFIA_TEXT.labels.nightActionsTitle}
      </div>
      <div className="text-sm text-[var(--text-dim)]">
        {hint}
      </div>
    </div>
  );
}
