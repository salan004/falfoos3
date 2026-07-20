import { GameSelector } from './GameSelector';
import { GameRenderer } from './GameRenderer';
import { YouTubeChatFeed } from './YouTubeChatFeed';
import { Leaderboard } from './Leaderboard';
import { AdminControls } from './AdminControls';
import { useGameState } from '../hooks/useGameState';

interface DashboardProps {
  game: ReturnType<typeof useGameState>;
}

export function Dashboard({ game }: DashboardProps) {
  return (
    <div className="h-screen p-3 flex flex-col gap-3">
      <header className="flex items-center justify-between bg-dark-panel border border-[var(--border-color)] rounded-[var(--radius)] px-5 py-3">
        <div className="flex items-center gap-4">
          <h1 className="neon-text text-2xl font-extrabold tracking-[3px]">
            FALFOOS
          </h1>
          <span className="text-[var(--text-dim)] text-xs uppercase tracking-wider">
            Gaming Dashboard
          </span>
        </div>
        <GameSelector
          gameList={game.gameList}
          activeGameId={game.activeGameId}
        />
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 overflow-hidden">
        <div className="flex flex-col gap-3 overflow-hidden">
          <div className="panel flex-1 overflow-auto">
            <GameRenderer
              activeGameId={game.activeGameId}
              gameState={game.gameState}
            />
          </div>
          <AdminControls
            activeGameId={game.activeGameId}
            gameState={game.gameState}
          />
        </div>

        <div className="flex flex-col gap-3 overflow-hidden">
          <YouTubeChatFeed messages={game.chatMessages} />
          <Leaderboard entries={game.leaderboard} />
          <div className="panel max-h-[130px] overflow-auto">
            <div className="text-[0.7rem] text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">
              Event Log
            </div>
            {game.gameEventLog.map((log, i) => (
              <div key={i} className="text-[0.65rem] text-[var(--text-dim)] font-mono py-px">
                &gt; {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
