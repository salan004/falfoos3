import { useEffect, useRef, useState } from 'react';
import { ChatMessage, YouTubeConnectionStatus } from '../types/game';
import { ConnectionStatusPill } from './ConnectionStatusPill';

interface ChatPanelProps {
  messages: ChatMessage[];
  status?: YouTubeConnectionStatus;
  showStatus?: boolean;
  showHeader?: boolean;
  variant?: 'room' | 'dashboard';
  className?: string;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}

export function ChatPanel({
  messages,
  status,
  showStatus = true,
  showHeader = true,
  variant = 'room',
  className = '',
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (!stickToBottom) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, stickToBottom]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distance < 80);
  };

  const containerClass = `live-chat h-full flex flex-col ${className}`.trim();

  return (
    <div className={containerClass} style={{ minHeight: 0 }}>
      {showHeader && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>
            الشات المباشر
          </h3>
          {showStatus && status && (
            <ConnectionStatusPill status={status} compact />
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2"
        style={{ minHeight: 0 }}
      >
        {messages.length === 0 && (
          <div className="text-center text-[var(--text-muted)] text-sm py-10 leading-relaxed">
            لا توجد رسائل بعد
            <br />
            <span className="text-xs">تظهر رسائل المشاهدين هنا لحظة وصولها من البث</span>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={`${msg.timestamp}-${i}`} className="animate-fade-in chat-msg flex gap-2">
            {msg.authorImageUrl ? (
              <img
                src={msg.authorImageUrl}
                alt=""
                className="lc-avatar"
                loading="lazy"
              />
            ) : (
              <div className="lc-avatar lc-avatar-fallback">
                {msg.author.slice(0, 1)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="lc-name">{msg.author}</span>
                {msg.isModerator === true && (
                  <span className="badge badge-green lc-mod">🛡️ مشرف</span>
                )}
                <span className="lc-time ms-auto shrink-0">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
              <div className="lc-text">{msg.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}