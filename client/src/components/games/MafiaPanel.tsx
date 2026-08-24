import { GameState, MafiaGameState } from '../../types/game';
import { sendAdminCommand } from '../../utils/socket';
import { useMafiaLiveEvents } from './mafia/hooks/useMafiaLiveEvents';
import type { MafiaLiveNotice } from './mafia/hooks/useMafiaLiveEvents';
import { useGameRoomNotices } from '../../hooks/useGameRoomNotices';
import type { RoomNotice } from '../../hooks/useGameRoomNotices';
import { useMafiaPhase, getPhaseColor, getPhaseText } from './mafia/hooks/useMafiaPhase';
import { MAFIA_TEXT } from './mafia/mafia-text';
import { MafiaLobby } from './mafia/phases/MafiaLobby';
import { MafiaRoleReveal } from './mafia/phases/MafiaRoleReveal';
import { MafiaNight } from './mafia/phases/MafiaNight';
import { MafiaDay } from './mafia/phases/MafiaDay';
import { MafiaVoting } from './mafia/phases/MafiaVoting';
import { MafiaVoteResult } from './mafia/phases/MafiaVoteResult';
import { MafiaGameOver } from './mafia/phases/MafiaGameOver';

type AnyRoomNotice = MafiaLiveNotice | RoomNotice;

export function MafiaPanel({ gameState }: { gameState: GameState }) {
  const state = gameState as MafiaGameState;
  const live = useMafiaLiveEvents();
  const joinNotices = useGameRoomNotices('mafia');
  const subPhase = useMafiaPhase(state, live);

  const deadCount = state.players.filter((p) => !p.isAlive).length;
  const aliveCount =
    typeof state.aliveCount === 'number' ? state.aliveCount : state.players.length - deadCount;

  const atmoVars: React.CSSProperties | undefined =
    subPhase === 'voteResult' && live.votingResult
      ? ({
          '--atmo-a': live.votingResult.tie
            ? 'rgba(255,221,0,0.07)'
            : 'rgba(255,51,85,0.08)',
          '--atmo-b': live.votingResult.tie
            ? 'rgba(255,221,0,0.04)'
            : 'rgba(255,51,85,0.04)',
        } as React.CSSProperties)
      : undefined;

  const windowFor = (kind: 'night' | 'day' | 'voting') =>
    live.activeWindow && live.activeWindow.phaseKind === kind ? live.activeWindow : null;

  const noticeKey = (n: AnyRoomNotice) => `${n.kind}-${n.id}`;
  const noticeClass = (n: AnyRoomNotice) => {
    if (n.kind === 'nightResult') return 'notice-nightResult';
    if (n.kind === 'notEnoughPlayers') return 'notice-notEnoughPlayers';
    return `notice-${n.kind}`;
  };
  const renderNotice = (n: AnyRoomNotice) => {
    switch (n.kind) {
      case 'nightResult':
        return `🌙 ${(n as MafiaLiveNotice & { kind: 'nightResult' }).message}`;
      case 'notEnoughPlayers':
        return `⚠️ لاعبون غير كافيين (${(n as MafiaLiveNotice & { kind: 'notEnoughPlayers' }).count}/${
          (n as MafiaLiveNotice & { kind: 'notEnoughPlayers' }).required
        }) — اكتب !انضم للمشاركة`;
      case 'joined':
        return `👋 انضم ${(n as RoomNotice).displayName} إلى الصالة`;
      case 'rejected':
        return `⚠️ ${(n as RoomNotice).message}`;
      default:
        return '';
    }
  };

  const allNotices: AnyRoomNotice[] = [...live.notices, ...joinNotices].slice(-4);

  const renderPhase = () => {
    switch (subPhase) {
      case 'idle':
        return (
          <div className="lobby-panel" style={{ justifyContent: 'center', flex: 1 }}>
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div className="text-5xl font-extrabold glow-text-cyan mb-3">مافيا</div>
              <div className="join-banner" role="status">
                <span className="join-banner-dot" aria-hidden="true" />
                <span>اكتب !انضم في البث لبدء الصالة والانضمام</span>
              </div>
              <div className="text-sm text-[var(--text-muted)] mt-3">
                أو افتح الصالة من لوحة التحكم
              </div>
            </div>
          </div>
        );
      case 'lobby':
        return <MafiaLobby state={state} />;
      case 'roleReveal':
        return <MafiaRoleReveal rolesSummary={live.rolesSummary} activeWindow={live.activeWindow} />;
      case 'night':
        return <MafiaNight state={state} timerWindow={windowFor('night')} />;
      case 'day':
        return <MafiaDay state={state} timerWindow={windowFor('day')} />;
      case 'voting':
        return <MafiaVoting state={state} timerWindow={windowFor('voting')} />;
      case 'voteResult':
        return live.votingResult ? <MafiaVoteResult snapshot={live.votingResult} /> : null;
      case 'gameOver':
        return <MafiaGameOver state={state} onNewMatch={() => sendAdminCommand('mafia:reset')} />;
    }
  };

  return (
    <div
      className={`mafia-atmo atmo-${subPhase}`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '12px', ...atmoVars }}
    >
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="badge badge-cyan badge-lg">🎭 مافيا</span>
        <span className={`badge ${getPhaseColor(subPhase)} badge-lg`}>{getPhaseText(subPhase)}</span>
        <span className="badge badge-green badge-lg">👥 {aliveCount} {MAFIA_TEXT.labels.aliveSuffix}</span>
        {deadCount > 0 && (
          <span className="badge badge-red badge-lg">💀 {deadCount}</span>
        )}
        {state.round > 0 && (
          <span className="badge badge-purple badge-lg">{MAFIA_TEXT.labels.roundLabel} {state.round}</span>
        )}
      </div>

      {allNotices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {allNotices.map((n) => (
            <div key={noticeKey(n)} className={`notice-line ${noticeClass(n)}`}>
              {renderNotice(n)}
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'auto' }}>
        {renderPhase()}
      </div>

      {live.privateMessages.length > 0 && (
        <div className="panel" style={{ borderColor: 'var(--neon-purple)' }}>
          <div className="text-sm font-bold mb-2" style={{ color: 'var(--neon-purple)' }}>
            🔒 {MAFIA_TEXT.labels.hostFeedTitle}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '140px', overflow: 'auto' }}>
            {live.privateMessages.map((entry) => (
              <div key={entry.id} className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
                {' — '}
                {entry.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
