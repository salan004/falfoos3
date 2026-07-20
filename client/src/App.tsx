import { useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { useGameState } from './hooks/useGameState';

export default function App() {
  const game = useGameState();

  useEffect(() => {
    game.loadGames();
  }, []);

  return (
    <div style={{ position: 'relative', minHeight: '100vh' }}>
      <Dashboard game={game} />
      <div className="grid-overlay" />
    </div>
  );
}
