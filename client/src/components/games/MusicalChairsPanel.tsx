import { useEffect, useState } from 'react';
import { GameState, MusicalChairsGameState } from '../../types/game';
import { LobbyPanel } from '../game-room/LobbyPanel';
import { PlayerAvatar } from '../PlayerAvatar';
import { useSocketEvent } from '../../hooks/useWebSocket';

export function MusicalChairsPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as MusicalChairsGameState;
  const players = state.players ?? [];
  const [hostNotice, setHostNotice] = useState<{ msg: string; at: number } | null>(null);

  // Host feedback: closing the lobby with too few players used to be silent.
  useSocketEvent('mc:notEnoughPlayers', () => {
    setHostNotice({ msg: '⚠️ لاعبون غير كافيين — يلزم لاعبان على الأقل لبدء الجولات', at: Date.now() });
  });
  useEffect(() => {
    if (!hostNotice) return;
    const t = setTimeout(() => setHostNotice(null), 6000);
    return () => clearTimeout(t);
  }, [hostNotice]);

  if (state.phase === 'idle') {
    return (
      <LobbyPanel
        title="كراسي موسيقية"
        icon="🎵"
        accent="var(--neon-pink)"
        players={players}
        minPlayers={2}
        instruction="اكتب !انضم في البث للانضمام إلى الصالة"
        commandHint="الأمر القديم !دخول يعمل أيضاً"
        hideHeader
      >
        <div className="text-center text-sm text-[var(--text-muted)] mt-4">
          افتح الصالة من لوحة التحكم ثم أغلقها لبدء الجولات
        </div>
      </LobbyPanel>
    );
  }

  if (state.phase === 'finished') {
    const winner = players.find((p) => p.id === state.winner);
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <div className="text-5xl">🏆</div>
          <div className="glow-text-pink text-3xl font-extrabold">الفائز!</div>
          {winner && (
            <PlayerAvatar id={winner.id} name={winner.displayName} avatarUrl={winner.avatarUrl} size={64} />
          )}
          <div className="text-2xl font-extrabold glow-text-cyan">
            {winner?.displayName ?? 'غير معروف'}
          </div>
          <div className="text-[var(--text-dim)]">آخر من بقي على قيد الحياة!</div>
        </div>
      </div>
    );
  }

  const alivePlayers = players.filter((p) => !p.eliminated);
  const eliminatedPlayers = players.filter((p) => p.eliminated);
  const seated = alivePlayers.filter((p) => p.sat).length;

  const phaseHint =
    state.phase === 'lobby'
      ? 'الصالة مفتوحة — اكتب !انضم للانضمام'
      : 'الموسيقى تتوقف قريباً — اكتب !جلوس بسرعة!';

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2 items-center flex-wrap">
          <span className="badge badge-purple badge-lg">جولة {state.currentRound}</span>
          <span className="badge badge-green badge-lg">👥 {alivePlayers.length} متبقي</span>
          <span className="badge badge-yellow badge-lg">🪑 {state.chairsAvailable} كراسي</span>
          <span className="badge badge-cyan badge-lg">✅ {seated} جالسون</span>
        </div>
        {state.phase === 'lobby' && (
          <span className="badge badge-green badge-lg pulse-dot">🔴 الصالة مفتوحة</span>
        )}
      </div>

      <div className={`instruction-hint ${state.phase !== 'lobby' ? 'instruction-hint-hot' : ''}`}>
        {phaseHint}
      </div>

      {hostNotice && (
        <div className="notice-line notice-notEnoughPlayers text-center">{hostNotice.msg}</div>
      )}

      {state.phase === 'lobby' ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <div className="stat-number glow-text-pink">{players.length}</div>
          <div className="text-lg text-[var(--text-dim)]">لاعب في الصالة</div>
          <div className="players-grid w-full mt-2">
            {players.map((player) => (
              <div key={player.id} className="card player-chip animate-fade-in">
                <PlayerAvatar id={player.id} name={player.displayName} avatarUrl={player.avatarUrl} size={38} />
                <span className="player-chip-name">{player.displayName}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-4 overflow-auto">
          <div className="players-grid">
            {alivePlayers.map((player) => (
              <div
                key={player.id}
                className={`card player-chip ${player.sat ? 'chip-seated' : ''}`}
              >
                <PlayerAvatar id={player.id} name={player.displayName} avatarUrl={player.avatarUrl} size={38} />
                <span className="player-chip-name">{player.displayName}</span>
                {player.sat && <span className="badge badge-green" style={{ fontSize: '0.6rem' }}>🪑 جالس</span>}
              </div>
            ))}
          </div>

          {eliminatedPlayers.length > 0 && (
            <div>
              <div className="text-neon-red text-sm font-bold mb-2">خارج اللعبة ✕</div>
              <div className="flex gap-1.5 flex-wrap">
                {eliminatedPlayers.map((p) => (
                  <span key={p.id} className="badge badge-red opacity-75">
                    💀 {p.displayName}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
