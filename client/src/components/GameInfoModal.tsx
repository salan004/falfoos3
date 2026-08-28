import { useEffect, useRef } from 'react';
import { GameCatalogEntry, GameDetails } from '../data/gamesCatalog';
import { GameCardArtwork } from './GameCardArtwork';
import { resolveGameName, resolveGameArtwork } from '../data/gamesCatalog';

interface GameInfoModalProps {
  game: GameCatalogEntry;
  gameId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function GameInfoModal({ game, gameId, isOpen, onClose }: GameInfoModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const details = game.details;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[autofocus]')?.focus();
    } else {
      dialog.close();
      previousActiveElement.current?.focus();
    }

    return () => {
      dialog.close();
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    const dialog = dialogRef.current;
    if (dialog && e.target === dialog) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className="game-info-modal"
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-info-title"
    >
      <div className="game-info-content">
        <div className="game-info-header">
          <GameCardArtwork gameId={gameId} name={resolveGameName({ id: gameId, name: '', description: '' })} icon={game.icon} />
          <div className="game-info-title-area">
            <h2 id="game-info-title" className="game-info-title">{resolveGameName({ id: gameId, name: '', description: '' })}</h2>
            {game.descAr && <p className="game-info-summary">{game.descAr}</p>}
          </div>
          <button
            className="game-info-close"
            onClick={onClose}
            aria-label="إغلاق"
            autoFocus
          >
            ✕
          </button>
        </div>

        {details && (
          <div className="game-info-body">
            {details.howToPlay.length > 0 && (
              <section className="game-info-section">
                <h3 className="game-info-section-title">كيف تلعب</h3>
                <ol className="game-info-steps">
                  {details.howToPlay.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </section>
            )}

            {details.objective && (
              <section className="game-info-section">
                <h3 className="game-info-section-title">الهدف</h3>
                <p className="game-info-text">{details.objective}</p>
              </section>
            )}

            {details.winCondition && (
              <section className="game-info-section">
                <h3 className="game-info-section-title">شرط الفوز</h3>
                <p className="game-info-text">{details.winCondition}</p>
              </section>
            )}

            {details.commands && details.commands.length > 0 && (
              <section className="game-info-section">
                <h3 className="game-info-section-title">أوامر مهمة</h3>
                <ul className="game-info-commands">
                  {details.commands.map((cmd, i) => (
                    <li key={i}><code>{cmd}</code></li>
                  ))}
                </ul>
              </section>
            )}

            {details.chatInteraction && (
              <section className="game-info-section">
                <h3 className="game-info-section-title">التفاعل عبر الدردشة</h3>
                <p className="game-info-text">{details.chatInteraction}</p>
              </section>
            )}
          </div>
        )}

        <div className="game-info-footer">
          <button className="btn-neon" onClick={onClose}>فهمت، ابدأ اللعب</button>
        </div>
      </div>
    </dialog>
  );
}