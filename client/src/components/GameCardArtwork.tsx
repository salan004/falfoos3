import { useState } from 'react';
import { resolveGameArtwork } from '../data/gamesCatalog';

interface GameCardArtworkProps {
  gameId: string;
  name: string;
  /** Catalog glyph — used only as a translucent texture inside the fallback scene. */
  icon: string;
}

/**
 * Phase 10C artwork frame with two graceful tiers:
 *  1. Real asset from /assets/images/games/<id>.webp when the file exists
 *     (drop-in, zero code changes) — lazy + async decoded.
 *  2. Accent-driven CSS-gradient scene (current default until assets ship):
 *     spotlight + sheen + oversized translucent glyph watermark. Distinct per
 *     game accent, unified structure across all six games.
 */
export function GameCardArtwork({ gameId, name, icon }: GameCardArtworkProps) {
  const art = resolveGameArtwork(gameId);
  const [broken, setBroken] = useState(false);
  const showImage = !!art && !broken;

  return (
    <div className="gca-frame" aria-hidden="true">
      {showImage ? (
        <img
          className="gca-img"
          src={art!.src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="gca-scene">
          <span className="gca-spotlight" />
          <span className="gca-sheen" />
          <span className="gca-glyph">{icon}</span>
        </div>
      )}
      <span className="gca-overlay" />
    </div>
  );
}
