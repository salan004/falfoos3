import { useGameState } from '../hooks/useGameState';
import { Leaderboard } from '../components/Leaderboard';

/**
 * Phase 12 — dedicated leaderboard page. Reuses the existing live
 * <Leaderboard> component and session-scoped data; no ranking changes.
 */
export function LeaderboardPage({ game }: { game: ReturnType<typeof useGameState> }) {
  return (
    <main className="page-fade">
      <div className="content-page">
        <div className="panel" style={{ padding: '18px' }}>
          <Leaderboard entries={game.leaderboard} />
        </div>
      </div>
    </main>
  );
}
