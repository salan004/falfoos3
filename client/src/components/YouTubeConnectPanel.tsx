import { useCallback, useEffect, useRef, useState } from 'react';
import { YouTubeConnectionStatus } from '../types/game';
import { extractVideoId } from '../utils/youtube';
import { getSocket, sendYouTubeConnect, sendYouTubeDisconnect } from '../utils/socket';
import { ConnectionStatusPill } from './ConnectionStatusPill';

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

  return (
    <div className="panel yt-connect-panel">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-[0.72rem] text-[var(--text-muted)] uppercase tracking-wider font-bold">
          بث يوتيوب المباشر
        </div>
        <ConnectionStatusPill
          status={youtubeStatus}
          pending={anyPending && !(connected && pendingDisconnect)}
          pendingLabel={pendingDisconnect ? 'جارٍ قطع الاتصال…' : undefined}
        />
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="ألصق رابط البث المباشر هنا"
          value={url}
          onChange={handleUrlChange}
          disabled={connected || anyPending}
          className="text-sm bg-dark-card text-[var(--text-primary)] border border-[var(--border-color)] rounded-[var(--radius)] px-3 py-2 outline-none focus:border-neon-cyan disabled:opacity-50"
        />

        <div className="flex gap-2">
          <button
            className="btn-neon text-sm flex-1"
            onClick={handleConnect}
            disabled={!videoId || anyPending || connected}
            title={connected ? 'البث متصل بالفعل' : 'اتصال'}
          >
            {connected ? '✓ متصل' : pendingConnect ? '… جارٍ الاتصال' : 'اتصال'}
          </button>
          <button
            className="btn-neon-pink text-sm flex-1"
            onClick={handleDisconnect}
            disabled={!connected || anyPending}
            title={connected ? 'قطع الاتصال عن البث' : 'لا يوجد اتصال لقطعه'}
          >
            {pendingDisconnect ? '… جارٍ القطع' : 'قطع الاتصال'}
          </button>
        </div>

        {(connected || videoId || youtubeStatus.videoId) && (
          <div className="text-[0.7rem] text-[var(--text-dim)] font-mono truncate">
            معرّف الفيديو: {youtubeStatus.videoId ?? videoId}
          </div>
        )}

        {error && (
          <div className="yt-connect-error text-[0.72rem]" role="alert">
            ⚠️ {error}
          </div>
        )}

        {!connected && !error && !anyPending && (
          <div className="text-[0.68rem] text-[var(--text-muted)] leading-relaxed">
            يجب أن يكون البث مباشراً الآن حتى يتمكن النظام من العثور على الدردشة الحية.
          </div>
        )}
      </div>
    </div>
  );
}
