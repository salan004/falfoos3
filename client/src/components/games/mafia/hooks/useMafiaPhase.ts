import { MafiaGameState } from '../../../../types/game';
import type { MafiaLiveEvents } from './useMafiaLiveEvents';

export type MafiaSubPhase =
  | 'lobby'
  | 'roleReveal'
  | 'night'
  | 'day'
  | 'voting'
  | 'voteResult'
  | 'gameOver'
  | 'idle';

export interface MafiaSubPhaseInput {
  roleRevealOpen: boolean;
  votingResult: MafiaLiveEvents['votingResult'];
}

/**
 * Deterministic sub-phase resolution from server truth:
 * - idle / lobby / finished come straight from game:state phase.
 * - roleReveal = window opened by mafia:rolesAssigned, closed by first mafia:nightStarted.
 * - Within 'playing', the current segment is whichever of the three server
 *   timestamps (nightStartTime / dayStartTime / votingStartTime) is most recent.
 *   (votingStartTime stays > 0 after its segment ends, so recency - not zero-ness -
 *   identifies the active segment.)
 * - voteResult = a mafia:votingResult snapshot exists for the current voting
 *   segment; it naturally ends when the next nightStarted/dayStarted advances
 *   the segment timestamp.
 */
export function resolveMafiaSubPhase(state: MafiaGameState, live: MafiaSubPhaseInput): MafiaSubPhase {
  if (state.phase === 'idle') return 'idle';
  if (state.phase === 'finished') return 'gameOver';
  if (state.phase === 'lobby' || state.phase === 'paused') return 'lobby';

  // phase === 'playing'
  if (live.roleRevealOpen) return 'roleReveal';

  const { nightStartTime, dayStartTime, votingStartTime } = state;
  const latest = Math.max(nightStartTime, dayStartTime, votingStartTime);

  if (latest === votingStartTime && votingStartTime > 0) {
    return live.votingResult ? 'voteResult' : 'voting';
  }
  if (latest === dayStartTime && dayStartTime > 0) return 'day';

  return state.nightPhase ? 'night' : 'day';
}

export function useMafiaPhase(state: MafiaGameState, live: MafiaSubPhaseInput): MafiaSubPhase {
  return resolveMafiaSubPhase(state, live);
}

export function getPhaseText(subPhase: MafiaSubPhase): string {
  switch (subPhase) {
    case 'idle': return 'في الانتظار';
    case 'lobby': return 'الصالة - اكتب !انضم للانضمام';
    case 'roleReveal': return 'تم توزيع الأدوار';
    case 'night': return 'مرحلة الليل';
    case 'day': return 'مرحلة النهار - مناقشة';
    case 'voting': return 'مرحلة التصويت';
    case 'voteResult': return 'نتيجة التصويت';
    case 'gameOver': return 'انتهت اللعبة';
    default: return subPhase;
  }
}

export function getPhaseColor(subPhase: MafiaSubPhase): string {
  switch (subPhase) {
    case 'night': return 'badge-pink';
    case 'day':
    case 'voting': return 'badge-yellow';
    case 'voteResult': return 'badge-yellow';
    case 'gameOver': return 'badge-purple';
    case 'lobby':
    case 'roleReveal':
    default: return 'badge-cyan';
  }
}
