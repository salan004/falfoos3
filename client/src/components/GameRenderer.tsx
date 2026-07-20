import { GameState } from '../types/game';
import { TriviaPanel } from './games/TriviaPanel';
import { MusicalChairsPanel } from './games/MusicalChairsPanel';
import { MafiaPanel } from './games/MafiaPanel';
import { GuessingPanel } from './games/GuessingPanel';
import { DrawingCanvas } from './games/DrawingCanvas';
import { HideSeekPanel } from './games/HideSeekPanel';

interface GameRendererProps {
  activeGameId: string | null;
  gameState: GameState | null;
}

const GAME_COMPONENTS: Record<string, React.ComponentType<{ gameState: GameState }>> = {
  trivia: TriviaPanel,
  musical_chairs: MusicalChairsPanel,
  mafia: MafiaPanel,
  guessing: GuessingPanel,
  drawing: DrawingCanvas,
  hide_and_seek: HideSeekPanel,
};

export function GameRenderer({ activeGameId, gameState }: GameRendererProps) {
  if (!activeGameId) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        Select a game to begin
      </div>
    );
  }

  const GameComponent = GAME_COMPONENTS[activeGameId];
  if (!GameComponent) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-dim)' }}>
        Unknown game: {activeGameId}
      </div>
    );
  }

  return <GameComponent gameState={gameState ?? { gameId: activeGameId, phase: 'idle' }} />;
}
