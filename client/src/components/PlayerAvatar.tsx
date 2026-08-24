import { useState } from 'react';

/**
 * Only http(s) avatar URLs are ever rendered — anything else
 * (javascript:, data:, relative junk) falls back to the deterministic avatar.
 */
function isSafeAvatarUrl(url: string | undefined | null): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Deterministic hue (0-359) derived from the channel id — never random. */
function hueFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

interface PlayerAvatarProps {
  id: string;
  name: string;
  avatarUrl?: string;
  /** Pixel size of the square avatar. */
  size?: number;
}

/**
 * YouTube player avatar with a clean deterministic fallback:
 * first letter of the display name on a color derived from the channel id.
 */
export function PlayerAvatar({ id, name, avatarUrl, size = 40 }: PlayerAvatarProps) {
  const [broken, setBroken] = useState(false);
  const safeUrl = isSafeAvatarUrl(avatarUrl) ? avatarUrl : null;
  const showImage = safeUrl && !broken;

  return (
    <span
      className="player-avatar"
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.42) }}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={safeUrl}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          className="player-avatar-fallback"
          style={{
            background: `linear-gradient(145deg, hsl(${hueFromId(id)} 70% 22%), hsl(${(hueFromId(id) + 40) % 360} 70% 14%))`,
            color: `hsl(${hueFromId(id)} 90% 70%)`,
          }}
        >
          {(name || '?').trim().charAt(0).toUpperCase() || '?'}
        </span>
      )}
    </span>
  );
}
