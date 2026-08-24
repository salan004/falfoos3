import { useEffect } from 'react';
import { getSocket } from '../utils/socket';
import { playSound, installSoundUnlock, installUiClickFeedback } from '../utils/soundService';
import type { GameEvent } from '../types/game';

/**
 * Phase 12F-2 — centralized game-event → sound mapping.
 *
 * Pure read-side observation of the existing socket stream: no state writes,
 * no scoring/timing/state changes, zero server involvement. Mounted ONCE in
 * App; sounds are fire-and-forget and silently absent until assets exist.
 *
 * Countdown derivation (trivia-only decision): the public game:state payload
 * carries `timeLeft`; ticks for 5→1 and a final sting at 0 are derived by
 * diffing consecutive payloads — games themselves are untouched.
 */

let lastPhase: string | null = null;
let lastTimeLeft: number | null = null;

function handleStateSounds(payload: Record<string, unknown>): void {
  const phase = typeof payload.phase === 'string' ? payload.phase : null;
  if (phase && phase !== lastPhase) {
    // Lobby opens or play begins → start sting. `finished` is covered by
    // explicit gameOver events; other transitions stay silent.
    if ((phase === 'lobby' || phase === 'playing') && (lastPhase === 'idle' || lastPhase === null || lastPhase === 'finished')) {
      playSound('game-start');
    }
    lastPhase = phase;
  }

  const timeLeft = typeof payload.timeLeft === 'number' ? payload.timeLeft : null;
  if (timeLeft !== null) {
    if (timeLeft === 0 && lastTimeLeft !== null && lastTimeLeft > 0) {
      playSound('countdown-final');
    } else if (timeLeft >= 1 && timeLeft <= 5 && timeLeft !== lastTimeLeft) {
      playSound('countdown-tick');
    }
    lastTimeLeft = timeLeft;
  }
}

function handleEvent(event: GameEvent): void {
  switch (event.type) {
    case 'game:state':
      handleStateSounds(event.payload);
      break;
    case 'game:switched':
      playSound('transition');
      break;

    // Successful actions / correct answers
    case 'guessing:winner':
    case 'drawing:wordGuessed':
      playSound('correct');
      break;
    case 'trivia:answerRevealed':
      if ((event.payload as { totalAnswers?: number }).totalAnswers! > 0) playSound('correct');
      break;

    // Round completion
    case 'mc:roundEnded':
    case 'mafia:votingResult':
      playSound('round-end');
      break;

    // Match completion — ONE neutral fanfare for all observers
    case 'mc:gameOver':
    case 'mafia:gameOver':
    case 'trivia:finished':
      playSound('match-over');
      break;

    // Hide & Seek search outcomes
    case 'hs:zoneSearched': {
      const caught = (event.payload as { caught?: unknown[] }).caught;
      playSound(Array.isArray(caught) && caught.length > 0 ? 'correct' : 'wrong');
      break;
    }

    default:
      break;
  }
}

export function useGameSounds(): void {
  useEffect(() => {
    installSoundUnlock();
    installUiClickFeedback();

    const socket = getSocket();
    socket.on('game:event', handleEvent);
    return () => {
      socket.off('game:event', handleEvent);
    };
  }, []);
}
