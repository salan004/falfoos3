import { useCallback, useEffect, useRef, useState } from 'react';
import { YouTubeConnectionStatus } from '../types/game';
import { extractVideoId } from '../utils/youtube';
import { getSocket, sendYouTubeConnect, sendYouTubeDisconnect } from '../utils/socket';

interface YouTubeConnectPanelProps {
  youtubeStatus: YouTubeConnectionStatus;
}

export function YouTubeConnectPanel({ youtubeStatus }: YouTubeConnectPanelProps) {
  const [url, setUrl] = useState('');
  const [pendingConnect, setPendingConnect] = useState(false);
  const [pendingDisconnect, setPendingDisconnect] = useState(false);
  const [videoId, setVideoId] = useState<string | null>(null);
  const busyRef = useRef(false);

  // Any real status broadcast from the server resolves BOTH pending states
  // (success OR failure) — the UI can never stay stuck or falsely connected.
  useEffect(() => {
    const socket = getSocket();
    const resolvePending = () => {
      busyRef.current = false;
      setPendingConnect(false);
      setPendingDisconnect(false);
    };
    socket.on('youtube:status', resolvePending);
    return () => {
      socket.off('youtube:status', resolvePending);
    };
  }, []);

  const handleUrlChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setUrl(value);
    setVideoId(extractVideoId(value));
  }, []);

  const handleConnect = useCallback(() => {
    if (!videoId || busyRef.current || youtubeStatus.connected) return;
    busyRef.current = true;
    setPendingConnect(true);
    sendYouTubeConnect(videoId);
  }, [videoId, youtubeStatus.connected]);

  const handleDisconnect = useCallback(() => {
    if (busyRef.current || !youtubeStatus.connected) return;
    busyRef.current = true;
    setPendingDisconnect(true);
    sendYouTubeDisconnect();
  }, [youtubeStatus.connected]);

  const connected = youtubeStatus.connected;
  const error = youtubeStatus.error;
  const anyPending = pendingConnect || pendingDisconnect;

  // Phase 14 — supervised auto-reconnect after an unplanned drop.
  const reconnecting = !connected && !anyPending && !!youtubeStatus.reconnecting;

  // Relative-time helper for the health strip (Arabic-friendly, minute grain).
  const relTime = (ts: number | null | undefined): string => {
    if (!ts) return '—';
    const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    if (mins < 1) return 'الآن';
    if (mins < 60) return `قبل ${mins} د`;
    return `قبل ${Math.floor(mins / 60)} س`;
  };
  const health = youtubeStatus.health;

  // User-facing state machine: one dot + one large Arabic status line.
  type State = 'connected' | 'connecting' | 'disconnecting' | 'error' | 'disconnected';
  let state: State = 'disconnected';
  let statusText = 'غير متصل';
  let statusHint = 'اربط بث يوتيوب المباشر لتشغيل الألعاب على الهواء.';
  if (pendingConnect) {
    state = 'connecting';
    statusText = 'جارٍ الاتصال…';
    statusHint = 'نبحث الآن عن دردشة البث المباشر.';
  } else if (pendingDisconnect) {
    state = 'disconnecting';
    statusText = 'جارٍ قطع الاتصال…';
    statusHint = 'يتم إيقاف الاتصال بالبث.';
  } else if (connected && error) {
    state = 'error';
    statusText = 'خطأ في الاتصال';
    statusHint = error;
  } else if (connected) {
    state = 'connected';
    statusText = 'متصل — البث مباشر';
    statusHint = 'دردشة البث متاحة الآن، والأوامر تعمل على الهواء.';
  } else if (reconnecting) {
    state = 'connecting';
    statusText = `جارٍ إعادة الاتصال… المحاولة ${youtubeStatus.attempt ?? 1} من ${youtubeStatus.maxAttempts ?? 5}`;
    statusHint = 'انقطع الاتصال بالبث — نحاول استعادته تلقائيًا.';
  } else if (error) {
    state = 'error';
    statusText = 'تعذّر الاتصال';
    statusHint = error;
  }

  return (
    <div className="panel yt-live-card" data-state={state}>
      <header className="yt-live-head">
        <span className="yt-live-title-dot" aria-hidden="true" />
        <div className="min-w-0">
          <span className="yt-live-title">YouTube Live</span>
          <span className="yt-live-sub">بث يوتيوب المباشر</span>
        </div>
      </header>

      <div className="yt-live-status" role="status" aria-live="polite">
        <span className="yt-live-dot" aria-hidden="true" />
        <div className="min-w-0">
          <div className="yt-live-state">{statusText}</div>
          <div className="yt-live-hint">{statusHint}</div>
        </div>
      </div>

      {/* Phase 14 — connection health telemetry (admin-facing). */}
      {health && (
        <div className="yt-live-health">
          {health.quotaExceeded && (
            <span className="yt-live-health-warn" role="alert">
              ⚠️ تم تجاوز حصة YouTube API اليومية
            </span>
          )}
          {!connected && !reconnecting && health.lastErrorMessage && !health.quotaExceeded && (
            <span className="yt-live-health-warn">آخر خطأ: {health.lastErrorMessage}</span>
          )}
          <span>استجابة أخيرة: {relTime(health.lastSuccessAt)}</span>
          <span>استطلاعات ناجحة: {health.pollsOk}</span>
          <span>إخفاقات متتالية: {health.consecutiveFailures}</span>
        </div>
      )}

      <div className="yt-live-actions">
        {!connected && !anyPending && (
          <>
            <label className="sr-only" htmlFor="yt-url">
              رابط بث يوتيوب المباشر
            </label>
            <input
              id="yt-url"
              type="text"
              placeholder="ألصق رابط البث المباشر هنا"
              value={url}
              onChange={handleUrlChange}
              className="yt-live-input"
              dir="ltr"
              aria-invalid={!!(url && !videoId)}
            />
            {url.length > 0 && !videoId && (
              <p className="yt-live-invalid" role="alert">
                لم يتم التعرف على رابط بث صالح — الصق رابط بث مباشر من يوتيوب.
              </p>
            )}
          </>
        )}

        {connected ? (
          <button
            className="btn-neon-pink yt-live-btn"
            onClick={handleDisconnect}
            disabled={anyPending}
          >
            {pendingDisconnect ? '… جارٍ قطع الاتصال' : 'قطع الاتصال'}
          </button>
        ) : (
          <button
            className="btn-neon yt-live-btn"
            onClick={handleConnect}
            disabled={!videoId || anyPending || connected}
            title={error ? 'إعادة المحاولة' : undefined}
          >
            {pendingConnect && <span className="yt-live-spinner" aria-hidden="true" />}
            {pendingConnect ? '… جارٍ الاتصال' : error ? 'إعادة المحاولة' : 'تشغيل بث يوتيوب'}
          </button>
        )}

        {(connected || videoId || youtubeStatus.videoId) && (
          <div className="yt-live-meta" dir="ltr">
            Video ID: {youtubeStatus.videoId ?? videoId}
          </div>
        )}

        {!connected && !error && !anyPending && (
          <p className="yt-live-note">
            يجب أن يكون البث مباشراً الآن حتى يتمكن النظام من العثور على الدردشة الحية وتشغيل الأوامر.
          </p>
        )}
      </div>
    </div>
  );
}
