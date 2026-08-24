import { useCallback, useSyncExternalStore } from 'react';
import { getGameSettingsSchema } from '../config/game-settings-registry';
import { sendAdminCommand } from '../utils/socket';
import type { GameSettingsState, GameSettingsSchema } from '../types/game-settings';

const STORAGE_PREFIX = 'falfoos_game_settings_';

interface StoreState extends GameSettingsState {
  validationError: string | null;
}

type Schema = GameSettingsSchema;

const EMPTY_SETTINGS: Record<string, unknown> = {};

const DEFAULT_STATE: StoreState = {
  editableSettings: EMPTY_SETTINGS,
  lockedMatchSettings: EMPTY_SETTINGS,
  isLocked: false,
  validationError: null,
};

const stores = new Map<string, StoreState>();
const listeners = new Map<string, Set<() => void>>();

function notify(gameId: string): void {
  const set = listeners.get(gameId);
  if (set) {
    for (const listener of set) listener();
  }
}

function patchState(gameId: string, patch: Partial<StoreState>): void {
  const current = stores.get(gameId) ?? DEFAULT_STATE;
  stores.set(gameId, { ...current, ...patch });
  notify(gameId);
}

function persist(gameId: string, settings: Record<string, unknown>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + gameId, JSON.stringify(settings));
  } catch {
    // storage unavailable - settings stay in memory only
  }
}

function buildDefaults(schema: Schema | undefined): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  if (schema) {
    for (const setting of schema.settings) {
      defaults[setting.key] = setting.default;
    }
  }
  return defaults;
}

function hydrate(gameId: string): StoreState {
  const schema = getGameSettingsSchema(gameId);
  const defaults = buildDefaults(schema);

  let resolved: Record<string, unknown> = defaults;
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + gameId);
    if (stored && schema) {
      const parsed = JSON.parse(stored);
      const validSettings: Record<string, unknown> = {};
      for (const setting of schema.settings) {
        if (setting.key in parsed) {
          validSettings[setting.key] = parsed[setting.key];
        } else {
          validSettings[setting.key] = setting.default;
        }
      }
      resolved = validSettings;
    }
  } catch {
    resolved = defaults;
  }

  const state: StoreState = {
    editableSettings: resolved,
    lockedMatchSettings: EMPTY_SETTINGS,
    isLocked: false,
    validationError: null,
  };
  stores.set(gameId, state);
  persist(gameId, resolved);
  return state;
}

function getState(gameId: string): StoreState {
  let state = stores.get(gameId);
  if (!state) {
    state = hydrate(gameId);
  }
  return state;
}

function validateSettings(gameId: string, settings: Record<string, unknown>): string | null {
  const schema = getGameSettingsSchema(gameId);
  if (!schema) return null;

  for (const setting of schema.settings) {
    const value = settings[setting.key];

    if (setting.type === 'number' && typeof value === 'number') {
      if (setting.min !== undefined && value < setting.min) {
        return `${setting.labelAr}: يجب أن تكون القيمة ${setting.min} أو أكبر`;
      }
      if (setting.max !== undefined && value > setting.max) {
        return `${setting.labelAr}: يجب أن تكون القيمة ${setting.max} أو أقل`;
      }
    }

    if (setting.validation) {
      const error = setting.validation(value, settings);
      if (error) return error;
    }
  }
  return null;
}

export function useGameSettings(activeGameId: string | null) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!activeGameId) return () => undefined;
      let set = listeners.get(activeGameId);
      if (!set) {
        set = new Set();
        listeners.set(activeGameId, set);
      }
      set.add(onStoreChange);
      return () => {
        set.delete(onStoreChange);
      };
    },
    [activeGameId]
  );

  const getSnapshot = useCallback((): StoreState => {
    if (!activeGameId) return DEFAULT_STATE;
    return getState(activeGameId);
  }, [activeGameId]);

  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const schema: Schema | undefined = activeGameId
    ? getGameSettingsSchema(activeGameId)
    : undefined;

  const handleSettingChange = useCallback(
    (key: string, value: unknown) => {
      if (!activeGameId) return;
      const current = getState(activeGameId);
      const next = { ...current.editableSettings, [key]: value };
      const error = validateSettings(activeGameId, next);
      if (error) {
        patchState(activeGameId, { validationError: error });
        return;
      }
      patchState(activeGameId, { editableSettings: next, validationError: null });
      persist(activeGameId, next);
    },
    [activeGameId]
  );

  const saveSettings = useCallback((): boolean => {
    if (!activeGameId) return false;
    const current = getState(activeGameId);
    const error = validateSettings(activeGameId, current.editableSettings);
    if (error) {
      patchState(activeGameId, { validationError: error });
      return false;
    }
    patchState(activeGameId, { validationError: null });
    persist(activeGameId, current.editableSettings);
    return true;
  }, [activeGameId]);

  const pushSettingsToServer = useCallback((): boolean => {
    if (!activeGameId) return false;
    const current = getState(activeGameId);
    const error = validateSettings(activeGameId, current.editableSettings);
    if (error) {
      patchState(activeGameId, { validationError: error });
      return false;
    }
    sendAdminCommand(`${activeGameId}:updateSettings`, current.editableSettings);
    return true;
  }, [activeGameId]);

  const lockSettings = useCallback(() => {
    if (!activeGameId) return;
    const current = getState(activeGameId);
    patchState(activeGameId, {
      lockedMatchSettings: { ...current.editableSettings },
      isLocked: true,
    });
  }, [activeGameId]);

  const unlockSettings = useCallback(() => {
    if (!activeGameId) return;
    patchState(activeGameId, { lockedMatchSettings: {}, isLocked: false });
  }, [activeGameId]);

  const getEffectiveSettings = useCallback((): Record<string, unknown> => {
    return state.isLocked ? state.lockedMatchSettings : state.editableSettings;
  }, [state]);

  const getSetting = useCallback(
    (key: string): unknown => {
      const effective = state.isLocked ? state.lockedMatchSettings : state.editableSettings;
      if (key in effective) return effective[key];
      const setting = schema?.settings.find((s) => s.key === key);
      return setting?.default;
    },
    [state, schema]
  );

  return {
    schema,
    editableSettings: state.editableSettings,
    lockedMatchSettings: state.lockedMatchSettings,
    isLocked: state.isLocked,
    validationError: state.validationError,
    handleSettingChange,
    saveSettings,
    pushSettingsToServer,
    lockSettings,
    unlockSettings,
    getEffectiveSettings,
    getSetting,
  };
}
