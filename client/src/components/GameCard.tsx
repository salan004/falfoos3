import { GameConfig } from '../types/game';
import { GAMES_CATALOG, PHASE_LABELS_AR, readPlayerCount, resolveGameName, resolveGameDescription } from '../data/gamesCatalog';
import { GameCardArtwork } from './GameCardArtwork';

interface GameCardProps {
  game: GameConfig;
  isActive: boolean;
  gameState: { phase: string } | null;
  playerState: Record<string, unknown> | null;
  onClick: () => void;
  compact?: boolean;
  featured?: boolean;
}

export function GameCard({ game, isActive, gameState, playerState, onClick, compact = false, featured = false }: GameCardProps) {
  const meta = GAMES_CATALOG[game.id];
  const playerCount = isActive ? readPlayerCount(playerState as never) : null;

  return (
    <button
      className={`card game-card text-right ${featured ? 'featured' : ''} ${compact ? 'compact' : ''}`}
      style={{ '--card-accent': meta?.accent } as React.CSSProperties}
      onClick={onClick}
      aria-label={`${resolveGameName(game)} — ${isActive ? 'مفعّلة' : 'متاح'}`}
    >
      <GameCardArtwork gameId={game.id} name={resolveGameName(game)} icon={meta?.icon ?? '🎮'} />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`${compact ? 'text-lg' : 'text-xl'} font-extrabold game-card-title`} style={{ color: 'var(--text-primary)' }}>
            {resolveGameName(game)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {featured && !compact && (
            <span className="featured-tag">⭐ اللعبة الرئيسية</span>
          )}
          {isActive ? (
            <span className={`badge ${gameState ? 'badge-green' : 'badge-cyan'}`}>
              {gameState ? PHASE_LABELS_AR[gameState.phase] || gameState.phase : 'مفعّلة'}
            </span>
          ) : (
            <span className="badge badge-cyan">متاح</span>
          )}
        </div>
      </div>

      <p className="game-card-desc desc-slot">
        {resolveGameDescription(game)}
      </p>

      <div className="mt-auto pt-3 flex items-center justify-between border-t border-[var(--border-color)]">
        <span className="btn-card-cta">
          ادخل اللعبة <span className="arrow">←</span>
        </span>
        {playerCount !== null && (
          <span className="badge badge-yellow">👥 {playerCount}</span>
        )}
      </div>
    </button>
  );
}
