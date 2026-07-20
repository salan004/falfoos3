import { GameState, MusicalChairsGameState } from '../../types/game';

export function MusicalChairsPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as MusicalChairsGameState;

  if (state.phase === 'idle') {
    return (
      <div className="flex items-center justify-center h-full text-[var(--text-dim)]">
        <div className="text-center">
          <div className="neon-text-pink text-2xl font-extrabold mb-2">كراسي موسيقية</div>
          <div className="text-sm">افتح الصالة ليتمكن المشاهدون من كتابة <strong>!دخول</strong></div>
        </div>
      </div>
    );
  }

  if (state.phase === 'finished') {
    const winner = state.players?.find((p) => p.id === state.winner);
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-3xl font-extrabold mb-2">🏆 الفائز</div>
          <div className="text-xl neon-text-pink font-bold">
            {winner?.displayName ?? 'غير معروف'}
          </div>
          <div className="text-[var(--text-dim)] mt-2">آخر من بقي على قيد الحياة!</div>
        </div>
      </div>
    );
  }

  const alivePlayers = state.players?.filter((p) => !p.eliminated) ?? [];
  const eliminatedPlayers = state.players?.filter((p) => p.eliminated) ?? [];
  const seated = alivePlayers.filter((p) => p.sat).length;

  const phaseHint =
    state.phase === 'lobby'
      ? 'اكتب !دخول للانضمام'
      : 'اكتب !جلوس لجلوس';

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex gap-3 items-center">
          <span className="badge badge-cyan">جولة {state.currentRound}</span>
          <span className="badge badge-green">{alivePlayers.length} متبقي</span>
          <span className="badge badge-pink">{state.chairsAvailable} كراسي</span>
          {state.phase === 'lobby' && (
            <span className="badge badge-red animate-pulse">الصالة مفتوحة</span>
          )}
        </div>
      </div>

      <div className="text-center text-[0.75rem] text-[var(--text-dim)] animate-pulse">
        {phaseHint}
      </div>

      {state.phase === 'lobby' && (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <div className="neon-text text-4xl font-extrabold">
              {state.players?.length ?? 0}
            </div>
            <div className="text-[var(--text-dim)] mt-1">لاعباً انضموا</div>
          </div>
        </div>
      )}

      {state.phase === 'playing' && (
        <div className="flex-1 flex flex-col gap-3 overflow-auto">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
            {alivePlayers.map((player) => (
              <div
                key={player.id}
                className={`card text-center p-3 ${
                  player.sat ? 'shadow-neon-green' : ''
                }`}
                style={{
                  borderColor: player.sat
                    ? 'var(--neon-green)'
                    : 'var(--border-color)',
                  background: player.sat
                    ? 'rgba(0,255,136,0.05)'
                    : 'var(--bg-card)',
                }}
              >
                <div className="text-xl mb-1">
                  {player.sat ? '🪑' : '💃'}
                </div>
                <div className="text-sm font-semibold">{player.displayName}</div>
                {player.sat && (
                  <div className="text-[0.65rem] text-neon-green mt-0.5">جالس</div>
                )}
              </div>
            ))}
          </div>

          {eliminatedPlayers.length > 0 && (
            <div>
              <div className="text-neon-red text-xs font-semibold mb-1.5">
                خارج ⨯
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {eliminatedPlayers.map((p) => (
                  <span key={p.id} className="badge badge-red opacity-70">
                    {p.displayName}
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
