import { GameState, HideSeekGameState } from '../../types/game';
import { LobbyPanel } from '../game-room/LobbyPanel';
import { PlayerAvatar } from '../PlayerAvatar';

const ALL_ZONES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D1', 'D2', 'D3', 'D4'];

export function HideSeekPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as HideSeekGameState;
  const players = state.players ?? [];
  const searchedZones = new Set(state.searchedZones ?? []);
  const hiddenCount = players.filter((p) => p.zone && !p.isCaught).length;
  const caughtCount = players.filter((p) => p.isCaught).length;
  const caughtPlayers = players.filter((p) => p.isCaught);

  if (state.phase === 'idle') {
    return (
      <LobbyPanel
        title="الغميضة"
        icon="👻"
        accent="var(--neon-purple)"
        players={players}
        instruction="اكتب !انضم في البث للانضمام إلى المختبئين"
        commandHint="بعد الانضمام اختبئ عبر !hide A1 (المناطق من A1 إلى D4)"
      >
        <div className="text-center text-sm text-[var(--text-muted)] mt-4">
          اضغط «بدء الاختباء» من لوحة التحكم لفتح الصالة
        </div>
      </LobbyPanel>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="badge badge-purple badge-lg">👻 الغميضة</span>
        <span className="badge badge-cyan badge-lg">👥 {players.length} لاعب</span>
        <span className="badge badge-green badge-lg">🙈 {hiddenCount} مختبئون</span>
        <span className="badge badge-red badge-lg">💀 {caughtCount} ضُبطوا</span>
      </div>

      {players.length === 0 && (
        <div className="instruction-hint">
          الصالة مفتوحة — لا يوجد لاعبون بعد! انتظر انضمام المشاهدين عبر !انضم
        </div>
      )}

      {caughtPlayers.length > 0 && (
        <div className="panel" style={{ borderColor: 'rgba(255,51,85,0.4)', padding: '10px 14px' }}>
          <div className="text-neon-red text-sm font-bold mb-2">ضُبطوا في البحث ✕</div>
          <div className="players-grid">
            {caughtPlayers.map((p) => (
              <div key={p.id} className="card player-chip" style={{ opacity: 0.75 }}>
                <PlayerAvatar id={p.id} name={p.displayName} avatarUrl={p.avatarUrl} size={34} />
                <span className="player-chip-name">{p.displayName}</span>
                <span className="badge badge-red" style={{ fontSize: '0.58rem' }}>{p.zone}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="zones-grid">
        {ALL_ZONES.map((zone) => {
          const isSearched = searchedZones.has(zone);
          const playersHere = players.filter((p) => p.zone === zone);
          const caughtHere = playersHere.filter((p) => p.isCaught);
          const safeHere = playersHere.filter((p) => !p.isCaught);

          return (
            <div
              key={zone}
              className={`zone-cell ${isSearched ? (caughtHere.length > 0 ? 'zone-caught' : 'zone-safe') : ''}`}
            >
              <div className={`zone-label ${isSearched ? '' : 'glow-text-purple'}`}>{zone}</div>
              <div className="zone-count">{playersHere.length > 0 ? `${playersHere.length} هنا` : '—'}</div>
              {isSearched && (
                <div className="zone-result">
                  {caughtHere.length > 0 ? (
                    <span style={{ color: 'var(--neon-red)' }}>
                      ☠ {caughtHere.map((p) => p.displayName).join('، ')}
                    </span>
                  ) : (
                    <span style={{ color: 'var(--neon-green)' }}>✓ آمنة</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
