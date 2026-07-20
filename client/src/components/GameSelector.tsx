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
        style={{ minWidth: '200px' }}
      >
        {gameList.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button className="btn-neon" onClick={handleStart}>
        ▶ Start
      </button>
      <button className="btn-neon-pink" onClick={handleStop}>
        ■ Stop
      </button>
    </div>
  );
}
