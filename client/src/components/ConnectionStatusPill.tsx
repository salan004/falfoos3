import { YouTubeConnectionStatus } from '../types/game';

interface ConnectionStatusPillProps {
  status: YouTubeConnectionStatus;
  /** Shows the transient "connecting" state (until the real server status arrives). */
  pending?: boolean;
  /** Label override for the transient state, e.g. «جارٍ قطع الاتصال…». */
  pendingLabel?: string;
  compact?: boolean;
}

/**
 * Single source of truth for YouTube connection state across the app.
 * Reflects ONLY the real server-reported status — never a button click.
 */
export function ConnectionStatusPill({ status, pending = false, pendingLabel, compact = false }: ConnectionStatusPillProps) {
  const { connected, error } = status;

  const stateClass = connected ? 'ok' : pending ? 'pending' : error ? 'err' : 'off';
  const icon = connected ? '🟢' : pending ? '🟡' : '🔴';
  const label = connected
    ? compact
      ? 'متصل'
      : 'متصل — البث مباشر'
    : pending
      ? pendingLabel ?? 'جارٍ الاتصال…'
      : error
        ? compact
          ? 'تعذر الاتصال'
          : 'تعذر الاتصال — حاول مجدداً'
        : 'غير متصل';

  return (
    <span
      className={`conn-pill conn-${stateClass} ${compact ? 'compact' : ''}`}
      title={error ?? label}
    >
      <span className="conn-icon" aria-hidden="true">{icon}</span>
      <span className="conn-label">{label}</span>
      <span className="conn-dot" aria-hidden="true" />
    </span>
  );
}
