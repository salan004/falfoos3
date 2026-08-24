import { getGameSettingsSchema } from '../../config/game-settings-registry';
import { GameSettingField } from './GameSettingField';
import { useGameSettings } from '../../hooks/useGameSettings';

interface GameSettingsPanelProps {
  activeGameId: string | null;
  isLocked: boolean;
  serverErrors?: string[] | null;
}

export function GameSettingsPanel({ activeGameId, isLocked, serverErrors }: GameSettingsPanelProps) {
  const {
    schema,
    editableSettings,
    validationError,
    handleSettingChange,
    saveSettings,
    pushSettingsToServer
  } = useGameSettings(activeGameId);

  if (!activeGameId || !schema || schema.settings.length === 0) {
    return null;
  }

  const handleSave = () => {
    if (saveSettings()) {
      pushSettingsToServer();
    }
  };

  return (
    <div className="panel mb-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="badge badge-pink text-[0.65rem]">إعدادات اللعبة</span>
        {isLocked && (
          <span className="badge badge-red text-[0.65rem] animate-pulse">🔒 مقفلة</span>
        )}
      </div>

      <div className="space-y-3">
        {schema.settings.map((setting) => (
          <GameSettingField
            key={setting.key}
            setting={setting}
            value={editableSettings[setting.key] ?? setting.default}
            onChange={(value) => handleSettingChange(setting.key, value)}
            error={validationError}
            disabled={isLocked}
          />
        ))}

        {validationError && (
          <div className="text-neon-red text-xs flex items-center gap-1">
            <span>⚠️</span>
            <span>{validationError}</span>
          </div>
        )}

        {serverErrors && serverErrors.length > 0 && (
          <div className="space-y-1">
            {serverErrors.map((err, i) => (
              <div key={i} className="text-neon-red text-xs flex items-center gap-1">
                <span>⚠️ الخادم:</span>
                <span>{err}</span>
              </div>
            ))}
          </div>
        )}

        {!isLocked && (
          <button
            onClick={handleSave}
            className="btn-neon text-sm w-full mt-2"
            disabled={!!validationError}
          >
            💾 حفظ الإعدادات
          </button>
        )}
      </div>
    </div>
  );
}
