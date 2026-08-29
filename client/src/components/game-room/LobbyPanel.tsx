import { ReactNode } from 'react';
import { GamePlayerSummary } from '../../types/game';
import { PlayerAvatar } from '../PlayerAvatar';

interface LobbyPanelProps {
  title: string;
  icon?: string;
  accent?: string;
  players: GamePlayerSummary[];
  minPlayers?: number | null;
  maxPlayers?: number | null;
  /** Primary viewer instruction (large, glowing). */
  instruction?: string;
  /** Optional secondary line (e.g. legacy command aliases). */
  commandHint?: string;
  /** Hide the title/icon header when rendered inside GamePage (which has its own header). */
  hideHeader?: boolean;
  children?: ReactNode;
}

const DEFAULT_INSTRUCTION = 'اكتب !انضم في البث للانضمام';

/**
 * Shared game-room lobby: big title, glowing join instruction,
 * live player grid with YouTube avatars and min/max progress.
 */
export function LobbyPanel({
  title,
  icon,
  accent,
  players,
  minPlayers = null,
  maxPlayers = null,
  instruction = DEFAULT_INSTRUCTION,
  commandHint,
  children,
  hideHeader = false,
}: LobbyPanelProps) {
  const count = players.length;
  const belowMin = minPlayers !== null && count < minPlayers;

  return (
    <div className="lobby-panel" style={accent ? ({ '--lobby-accent': accent } as React.CSSProperties) : undefined}>
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="flex items-center gap-3">
            {icon && (
              <span className="game-icon" style={{ borderColor: accent, boxShadow: accent ? `0 0 18px ${accent}33` : undefined }}>
                {icon}
              </span>
            )}
            <h2 className="room-title" style={{ margin: 0 }}>{title}</h2>
          </div>
          <span className="badge badge-green lobby-count">
            👥 {count}{maxPlayers ? ` / ${maxPlayers}` : ''} لاعب
          </span>
        </div>
      )}

      <div className="join-banner" role="status">
        <span className="join-banner-dot" aria-hidden="true" />
        <span>{instruction}</span>
      </div>
      {commandHint && (
        <div className="text-center text-[0.78rem] text-[var(--text-muted)] mt-1.5">{commandHint}</div>
      )}

      <div className="mt-4">
        {count === 0 ? (
          <div className="lobby-empty">
            <div className="text-5xl mb-2">🎮</div>
            <div className="text-lg font-bold text-[var(--text-primary)]">في انتظار اللاعبين…</div>
            <div className="text-sm text-[var(--text-dim)] mt-1">كن أول من ينضم عبر دردشة البث!</div>
          </div>
        ) : (
          <>
            {minPlayers !== null && belowMin && (
              <div className="panel text-center py-2 mb-3" style={{ borderColor: 'var(--neon-yellow)' }}>
                <span className="text-neon-yellow text-sm font-bold">
                  ⚠️ مطلوب {minPlayers - count} لاعبين إضافيين على الأقل للبدء
                </span>
              </div>
            )}
            <div className="players-grid">
              {players.map((p) => (
                <div key={p.id} className="card player-chip animate-fade-in">
                  <PlayerAvatar id={p.id} name={p.displayName} avatarUrl={p.avatarUrl} size={44} />
                  <span className="player-chip-name">{p.displayName}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {children}
    </div>
  );
}
