import { GameSelector } from './GameSelector';
import { GameRenderer } from './GameRenderer';
import { YouTubeChatFeed } from './YouTubeChatFeed';
import { YouTubeConnectPanel } from './YouTubeConnectPanel';
import { Leaderboard } from './Leaderboard';
import { AdminControls } from './AdminControls';
import { AdminGate } from './AdminGate';
import { useGameState } from '../hooks/useGameState';

interface DashboardProps {
  game: ReturnType<typeof useGameState>;
}

export function Dashboard({ game }: DashboardProps) {
  return (
    <div className="dash-shell">
      <header className="panel dash-toolbar">
        <div className="flex items-center gap-3">
          <span className="badge badge-cyan">لوحة التحكم</span>
          <span className="text-[var(--text-dim)] text-xs">
            إدارة الجلسة والألعاب النشطة
          </span>
          <AdminGate />
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
          <YouTubeConnectPanel youtubeStatus={game.youtubeStatus} />
          <YouTubeChatFeed messages={game.chatMessages} />
          <Leaderboard entries={game.leaderboard} />
          <div className="panel max-h-[130px] overflow-auto">
            <div className="text-[0.7rem] text-[var(--text-muted)] mb-1.5 uppercase tracking-wider">
              سجل الأحداث
            </div>
            {game.gameEventLog.map((log, i) => (
              <div key={i} className="text-[0.65rem] text-[var(--text-dim)] font-mono py-px">
                {'>'} {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
