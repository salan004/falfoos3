import { GameState } from '../../types/game';
import { PlayerAvatar } from '../PlayerAvatar';

interface PanelPlayer {
  id: string;
  displayName: string;
  avatarUrl?: string;
  status?: string;
}

interface PlayersPanelProps {
  gameId: string;
  gameState: GameState | null;
}

interface StatusMeta {
  label: string;
  icon: string;
  mod: string;
}

/**
 * Phase 10A status presentation — labels/icons/colors ONLY.
 * Every status here is produced by the Phase 9 public-state contract
 * (server-side rules); this component invents nothing and reveals nothing
 * beyond what getPublicState() already broadcasts.
 */
const STATUS_META: Record<string, StatusMeta> = {
  playing: { label: 'يلعب', icon: '🎮', mod: 'playing' },
  alive: { label: 'حي', icon: '💚', mod: 'alive' },
  correct: { label: 'صحيح', icon: '✓', mod: 'correct' },
  wrong: { label: 'خطأ', icon: '✗', mod: 'wrong' },
  eliminated: { label: 'مُقصى', icon: '⛔', mod: 'eliminated' },
  dead: { label: 'خارج', icon: '💀', mod: 'dead' },
  winner: { label: 'الفائز', icon: '👑', mod: 'winner' },
  drawing: { label: 'يرسم', icon: '🎨', mod: 'drawing' },
  hiding: { label: 'مختبي', icon: '🙈', mod: 'hiding' },
  found: { label: 'وُجد', icon: '🔍', mod: 'found' },
};

const NEUTRAL_STATUS: StatusMeta = { label: 'لاعب', icon: '•', mod: 'neutral' };

/** trivia/mc/mafia/hs expose `players`, guessing/drawing expose `participants`. */
function rosterOf(gameState: GameState): PanelPlayer[] {
  const state = gameState as unknown as Record<string, unknown>;
  if (Array.isArray(state.players)) return state.players as PanelPlayer[];
  if (Array.isArray(state.participants)) return state.participants as PanelPlayer[];
  return [];
}

/**
 * Live roster of the active game session, rendered below the game screen.
 * Consumes the existing game:state payloads — no new events, no backend.
 */
export function PlayersPanel({ gameId, gameState }: PlayersPanelProps) {
  // Only render for the room's own ACTIVE game; inactive rooms keep their banner.
  if (!gameState || gameState.gameId !== gameId) return null;

  const roster = rosterOf(gameState);
  const isLive = gameState.phase === 'playing';

  return (
    <section className="panel players-panel">
      <div className="pp-head">
        <div className="flex items-center gap-2">
          <span className="pp-title">اللاعبون</span>
          <span className="badge badge-cyan pp-count">👥 {roster.length}</span>
        </div>
        {isLive && (
          <span className="pp-live">
            <span className="pp-live-dot" aria-hidden="true" />
            مباشر
          </span>
        )}
      </div>

      {roster.length === 0 ? (
        <div className="lobby-empty pp-empty">
          <div className="text-3xl mb-1">👥</div>
          <div className="font-bold text-[var(--text-primary)]">في انتظار اللاعبين…</div>
          <div className="text-sm text-[var(--text-dim)] mt-1">
            التفاعل عبر دردشة البث المباشر
          </div>
        </div>
      ) : (
        <div className="pp-body">
          {roster.map((player, i) => {
            const meta =
              (player.status && STATUS_META[player.status]) || NEUTRAL_STATUS;
            const dimmed = meta.mod === 'eliminated' || meta.mod === 'dead';
            return (
              <div
                key={player.id}
                className={`card pp-card animate-fade-in ${
                  meta.mod === 'winner' ? 'pp-card-winner' : ''
                } ${dimmed ? 'pp-card-dim' : ''}`}
                style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
              >
                <PlayerAvatar
                  id={player.id}
                  name={player.displayName}
                  avatarUrl={player.avatarUrl}
                  size={48}
                />
                <div className="pp-info">
                  <span className="pp-name" title={player.displayName}>
                    {player.displayName}
                  </span>
                  <span className={`pp-status pp-status--${meta.mod}`}>
                    <span aria-hidden="true">{meta.icon}</span>
                    {meta.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
