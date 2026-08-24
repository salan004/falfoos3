import { useEffect, useState } from 'react';
import type { MafiaPhaseWindow } from '../hooks/useMafiaLiveEvents';
import { MAFIA_TEXT } from '../mafia-text';

interface MafiaPhaseTimerProps {
  window: MafiaPhaseWindow | null;
  labelAr?: string;
}

export function MafiaPhaseTimer({ window: phaseWindow, labelAr }: MafiaPhaseTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, []);

  if (!phaseWindow || phaseWindow.totalSeconds <= 0) return null;

  const msLeft = phaseWindow.endsAt - now;
  if (msLeft <= 0) return null;

  const secondsLeft = Math.ceil(msLeft / 1000);
  const clampedSeconds = Math.min(secondsLeft, phaseWindow.totalSeconds);
  const percent = Math.max(0, Math.min(100, (clampedSeconds / phaseWindow.totalSeconds) * 100));

  const urgent = secondsLeft <= 10;
  const warning = !urgent && percent <= 30;

  const color = urgent ? 'var(--neon-red)' : warning ? 'var(--neon-yellow)' : 'var(--neon-green)';
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="panel" style={{ marginTop: '8px' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold" style={{ color }}>
          {labelAr || MAFIA_TEXT.labels.remainingTime}
        </span>
        <span
          className="font-mono text-xl"
          style={{ color, animation: urgent ? 'pulse 0.5s infinite' : 'none' }}
        >
          {mins}:{secs.toString().padStart(2, '0')}
        </span>
      </div>
      <div
        className="h-3 bg-[var(--bg-card)] rounded-full overflow-hidden"
        style={{ border: '1px solid var(--border-color)' }}
      >
        <div
          className="h-full transition-all duration-300 ease-out"
          style={{
            width: `${percent}%`,
            background: color,
            boxShadow: `0 0 10px ${color}, 0 0 20px ${color}`,
          }}
        />
      </div>
    </div>
  );
}
