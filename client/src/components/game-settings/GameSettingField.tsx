import { GameSettingDefinition } from '../../types/game-settings';

interface GameSettingFieldProps {
  setting: GameSettingDefinition;
  value: unknown;
  onChange: (value: string | number | boolean) => void;
  error?: string | null;
  disabled?: boolean;
}

export function GameSettingField({ setting, value, onChange, error, disabled }: GameSettingFieldProps) {
  const hasError = error && error.includes(setting.labelAr);

  switch (setting.type) {
    case 'number': {
      const numValue = typeof value === 'number' ? value : Number(setting.default) || 0;
      return (
        <div className="flex items-center gap-3">
          <label className="text-sm text-[var(--text-primary)] min-w-[140px]">
            {setting.labelAr}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={numValue}
              onChange={(e) => onChange(parseInt(e.target.value) || 0)}
              min={setting.min}
              max={setting.max}
              step={setting.step || 1}
              disabled={disabled}
              className={`w-20 text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan ${hasError ? 'border-neon-red' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            {setting.labelAr && <span className="text-xs text-[var(--text-dim)]">({setting.label})</span>}
          </div>
        </div>
      );
    }
    case 'select': {
      return (
        <div className="flex items-center gap-3">
          <label className="text-sm text-[var(--text-primary)] min-w-[140px]">
            {setting.labelAr}
          </label>
          <select
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className={`text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan ${hasError ? 'border-neon-red' : ''} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {setting.options?.map((opt) => (
              <option key={String(opt.value)} value={String(opt.value)}>
                {opt.labelAr || opt.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case 'boolean': {
      const boolValue = typeof value === 'boolean' ? value : Boolean(setting.default);
      return (
        <div className="flex items-center gap-3">
          <label className="text-sm text-[var(--text-primary)] min-w-[140px]">
            {setting.labelAr}
          </label>
          <input
            type="checkbox"
            checked={boolValue}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className={`w-5 h-5 accent-neon-cyan ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
        </div>
      );
    }
    default:
      return null;
  }
}