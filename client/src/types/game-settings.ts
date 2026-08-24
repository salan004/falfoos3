export type SettingType = 'number' | 'select' | 'boolean';

export interface GameSettingDefinition {
  key: string;
  label: string;
  labelAr: string;
  type: SettingType;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: {
    value: unknown;
    label: string;
    labelAr: string;
  }[];
  validation?: (value: unknown, allSettings: Record<string, unknown>) => string | null;
}

export interface GameSettingsSchema {
  gameId: string;
  settings: GameSettingDefinition[];
}

export interface GameSettingsState {
  editableSettings: Record<string, unknown>;
  lockedMatchSettings: Record<string, unknown>;
  isLocked: boolean;
}