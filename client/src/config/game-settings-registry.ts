import type { GameSettingDefinition, GameSettingsSchema } from '../types/game-settings';

export type { GameSettingsSchema };

const mafiaSettings: GameSettingDefinition[] = [
  {
    key: 'minPlayers',
    label: 'Minimum Players',
    labelAr: 'الحد الأدنى للاعبين',
    type: 'number',
    default: 4,
    min: 4,
    max: 20,
    step: 1,
  },
  {
    key: 'maxPlayers',
    label: 'Maximum Players',
    labelAr: 'الحد الأقصى للاعبين',
    type: 'number',
    default: 20,
    min: 4,
    max: 20,
    step: 1,
    validation: (value: unknown, allSettings: Record<string, unknown>) => {
      const min = allSettings?.minPlayers as number;
      const max = value as number;
      if (typeof min === 'number' && typeof max === 'number' && min >= max) {
        return 'الحد الأدنى يجب أن يكون أقل من الحد الأقصى';
      }
      return null;
    },
  },
  {
    key: 'nightDuration',
    label: 'Night Duration',
    labelAr: 'مدة الليل',
    type: 'number',
    default: 30,
    min: 10,
    max: 120,
    step: 5,
  },
  {
    key: 'dayDuration',
    label: 'Discussion Duration',
    labelAr: 'مدة النقاش',
    type: 'number',
    default: 45,
    min: 15,
    max: 180,
    step: 5,
  },
  {
    key: 'votingDuration',
    label: 'Voting Duration',
    labelAr: 'مدة التصويت',
    type: 'number',
    default: 30,
    min: 10,
    max: 120,
    step: 5,
  },
];

export interface GameSettingsRegistryEntry {
  gameId: string;
  settings: GameSettingDefinition[];
}

export const GAME_SETTINGS_REGISTRY: Record<string, GameSettingsRegistryEntry> = {
  mafia: {
    gameId: 'mafia',
    settings: mafiaSettings,
  },
  trivia: {
    gameId: 'trivia',
    settings: [],
  },
  musical_chairs: {
    gameId: 'musical_chairs',
    settings: [],
  },
  guessing: {
    gameId: 'guessing',
    settings: [],
  },
  drawing: {
    gameId: 'drawing',
    settings: [],
  },
  hide_and_seek: {
    gameId: 'hide_and_seek',
    settings: [],
  },
};

// Server-provided schemas (delivered via game:list / /api/games).
// Source of truth when present; static registry above remains the offline fallback.
// Hydration never mutates stored setting values or localStorage.
const runtimeSchemas = new Map<string, GameSettingsSchema>();

export function hydrateGameSchemas(
  games: { id: string; settingsSchema?: GameSettingsSchema }[]
): void {
  for (const game of games) {
    const schema = game?.settingsSchema;
    if (
      schema &&
      schema.gameId === game.id &&
      Array.isArray(schema.settings) &&
      schema.settings.length > 0
    ) {
      runtimeSchemas.set(game.id, schema);
    }
  }
}

export function getGameSettingsSchema(gameId: string): GameSettingsSchema | undefined {
  const runtime = runtimeSchemas.get(gameId);
  if (runtime) return runtime;
  return GAME_SETTINGS_REGISTRY[gameId];
}

export function getAllGameSettingsSchemas(): GameSettingsSchema[] {
  const merged = new Map<string, GameSettingsSchema>();
  for (const entry of Object.values(GAME_SETTINGS_REGISTRY)) {
    merged.set(entry.gameId, { gameId: entry.gameId, settings: entry.settings });
  }
  for (const [id, schema] of runtimeSchemas) {
    merged.set(id, schema);
  }
  return Array.from(merged.values());
}
