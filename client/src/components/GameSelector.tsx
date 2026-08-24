import { GameConfig } from '../types/game';
import { sendAdminCommand } from '../utils/socket';

interface GameSelectorProps {
  gameList: GameConfig[];
  activeGameId: string | null;
}

export function GameSelector({ gameList, activeGameId }: GameSelectorProps) {
  const handleSwitch = (id: string) => {
    sendAdminCommand('switchGame', id);
  };

  const handleStart = () => {
    sendAdminCommand('startGame');
  };

  const handleStop = () => {
    sendAdminCommand('stopGame');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <select
        value={activeGameId ?? ''}
        onChange={(e) => handleSwitch(e.target.value)}
        className="text-sm px-3 py-2 outline-none focus:border-neon-cyan"
        style={{ minWidth: '200px' }}
      >
        {gameList.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button className="btn-neon text-sm" onClick={handleStart}>
        ▶ بدء
      </button>
      <button className="btn-neon-pink text-sm" onClick={handleStop}>
        ■ إيقاف
      </button>
    </div>
  );
}
