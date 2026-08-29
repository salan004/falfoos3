import { GameSettingsDisplay } from '../../../game-settings/GameSettingsDisplay';
import { getGameSettingsSchema } from '../../../../config/game-settings-registry';
import { MafiaPlayerCard } from '../components/MafiaPlayerCard';
import { MAFIA_TEXT } from '../mafia-text';
import type { MafiaGameState } from '../../../../types/game';

interface MafiaLobbyProps {
  state: MafiaGameState;
}

function readNumberSetting(settings: Record<string, unknown>, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' ? value : fallback;
}

export function MafiaLobby({ state }: MafiaLobbyProps) {
  const schema = getGameSettingsSchema('mafia');
  const defaults: Record<string, unknown> = {};
  for (const setting of schema?.settings ?? []) {
    defaults[setting.key] = setting.default;
  }

  const activeSettings =
    state.activeSettings && Object.keys(state.activeSettings).length > 0
      ? state.activeSettings
      : defaults;

  const minPlayers = readNumberSetting(activeSettings, 'minPlayers', 4);
  const maxPlayers = readNumberSetting(activeSettings, 'maxPlayers', 20);

  const players = state.players ?? [];
  const alivePlayers = players.filter((p) => p.isAlive);
  const settingsEditable = state.phase === 'idle' || state.phase === 'lobby';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <span className="badge badge-cyan text-lg">🎭 مافيا</span>
          <span className="badge badge-cyan">{MAFIA_TEXT.phases.lobby}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="badge badge-green">{alivePlayers.length} / {maxPlayers} لاعبين</span>
          <span className="badge badge-yellow">{MAFIA_TEXT.labels.minimum}: {minPlayers}</span>
        </div>
      </div>

      <GameSettingsDisplay
        gameId="mafia"
        settings={activeSettings}
        isLocked={!settingsEditable}
      />

      {alivePlayers.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <div className="text-4xl font-extrabold neon-text">مافيا</div>
          <div className="text-[var(--text-dim)]">في انتظار لاعبين...</div>
          <div className="text-sm text-[var(--neon-cyan)]">
            {MAFIA_TEXT.labels.write} <strong>{MAFIA_TEXT.actions.join}</strong> {MAFIA_TEXT.labels.toJoin}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 flex-1 overflow-auto">
          <div className="text-sm text-[var(--text-muted)] text-center">
            {MAFIA_TEXT.messages.playersProgress(alivePlayers.length, minPlayers)}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
            {players.map((p) => (
              <MafiaPlayerCard key={p.id} player={p} />
            ))}
          </div>

          {alivePlayers.length < minPlayers && (
            <div className="panel text-center" style={{ borderColor: 'var(--neon-yellow)' }}>
              <span className="text-neon-yellow text-sm">
                ⚠️ {MAFIA_TEXT.messages.extraPlayersNeeded(minPlayers - alivePlayers.length)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
