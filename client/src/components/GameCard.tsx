import { useState } from 'react';
import { GameConfig } from '../types/game';
import { GAMES_CATALOG, PHASE_LABELS_AR, readPlayerCount, resolveGameName, resolveGameDescription } from '../data/gamesCatalog';
import { GameCardArtwork } from './GameCardArtwork';
import { GameInfoModal } from './GameInfoModal';

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
  const [showModal, setShowModal] = useState(false);

  const handleCardClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('.game-card-learn-more')) {
      onClick();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const openModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowModal(true);
  };

  return (
    <>
      <article
        className={`card game-card text-right ${featured ? 'featured' : ''} ${compact ? 'compact' : ''}`}
        style={{ '--card-accent': meta?.accent } as React.CSSProperties}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="button"
        aria-label={`${resolveGameName(game)}${isActive ? ' — مفعّلة' : ''}`}
      >
        <GameCardArtwork gameId={game.id} name={resolveGameName(game)} icon={meta?.icon ?? '🎮'} />

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className={`${compact ? 'text-lg' : 'text-xl'} font-extrabold game-card-title`} style={{ color: 'var(--text-primary)' }}>
              {resolveGameName(game)}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isActive && gameState && (
              <span className={`badge ${gameState ? 'badge-green' : 'badge-cyan'}`}>
                {PHASE_LABELS_AR[gameState.phase] || gameState.phase}
              </span>
            )}
          </div>
        </div>

        <p className="game-card-desc desc-slot">
          {resolveGameDescription(game)}
        </p>

        <div className="mt-auto pt-3 flex items-center justify-between border-t border-[var(--border-color)]">
          <span className="btn-card-cta" aria-hidden="true">
            ادخل اللعبة <span className="arrow">←</span>
          </span>
          <div className="flex items-center gap-2">
            {playerCount !== null && (
              <span className="badge badge-yellow">👥 {playerCount}</span>
            )}
            {meta?.details && (
              <button
                type="button"
                className="btn-card-cta game-card-learn-more"
                onClick={openModal}
                aria-haspopup="dialog"
                aria-label={`تعرف على ${resolveGameName(game)} أكثر`}
              >
                تعرف أكثر
              </button>
            )}
          </div>
        </div>
      </article>

      <GameInfoModal
        game={meta ?? { icon: '🎮', accent: 'var(--neon-cyan)' }}
        gameId={game.id}
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}