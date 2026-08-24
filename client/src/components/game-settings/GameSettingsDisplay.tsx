import { getGameSettingsSchema } from '../../config/game-settings-registry';
import type { GameSettingDefinition } from '../../types/game-settings';

interface GameSettingsDisplayProps {
  gameId: string;
  settings: Record<string, unknown>;
  isLocked?: boolean;
}

export function GameSettingsDisplay({ gameId, settings, isLocked }: GameSettingsDisplayProps) {
  const schema = getGameSettingsSchema(gameId);
  if (!schema || schema.settings.length === 0) {
    return null;
  }

  return (
    <div className="panel mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="badge badge-pink text-[0.65rem]">إعدادات المباراة</span>
        {isLocked && (
          <span className="badge badge-red text-[0.65rem] animate-pulse">🔒 مقفلة</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        {schema.settings.map((setting: GameSettingDefinition) => {
          const value = settings[setting.key];
          const displayValue = value !== undefined ? value : setting.default;
          let displayText: string;
          
          if (setting.type === 'boolean') {
            displayText = displayValue ? 'مفعل' : 'معطل';
          } else if (typeof displayValue === 'number') {
            displayText = `${displayValue} ${setting.key.includes('Duration') ? 'ثانية' : ''}`;
          } else {
            displayText = String(displayValue);
          }
          
          return (
            <div key={setting.key} className="flex justify-between">
              <span className="text-[var(--text-dim)]">{setting.labelAr}</span>
              <span className="text-[var(--text-primary)] font-mono">{displayText}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}