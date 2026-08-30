import { useEffect, useRef, useState, useId } from 'react';
import { ChatMessage, YouTubeConnectionStatus } from '../types/game';
import { ConnectionStatusPill } from './ConnectionStatusPill';

interface ChatPanelProps {
  messages: ChatMessage[];
  status?: YouTubeConnectionStatus;
  showStatus?: boolean;
  showHeader?: boolean;
  variant?: 'room' | 'dashboard';
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
  messageCount?: number;
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
  showStatus,
  showHeader,
  variant = 'room',
  className = '',
  collapsed = false,
  onToggle,
  messageCount = 0,
}: ChatPanelProps) {
  const defaultShowHeader = variant === 'room' ? false : true;
  const defaultShowStatus = variant === 'room' ? false : true;
  const resolvedShowHeader = showHeader ?? defaultShowHeader;
  const resolvedShowStatus = showStatus ?? defaultShowStatus;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const messagesId = useId();

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

  const isMobileRoom = variant === 'room' && typeof window !== 'undefined' && window.innerWidth < 1025;

  if (isMobileRoom && collapsed) {
    return (
      <div className={containerClass} style={{ minHeight: 0 }}>
        <button
          type="button"
          className="chat-toggle"
          onClick={onToggle}
          aria-expanded="false"
          aria-controls={messagesId}
        >
          <span>الشات</span>
          {messageCount > 0 && (
            <span className="chat-toggle-badge" aria-live="polite" aria-atomic="true">
              {messageCount}
            </span>
          )}
          <span className="chat-toggle-chevron" aria-hidden="true">▲</span>
        </button>
      </div>
    );
  }

  return (
    <div className={containerClass} style={{ minHeight: 0 }}>
      {resolvedShowHeader && (
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>
            الشات المباشر
          </h3>
          {resolvedShowStatus && status && (
            <ConnectionStatusPill status={status} compact />
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        id={messagesId}
        role="log"
        aria-live="polite"
        aria-atomic="false"
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

      {isMobileRoom && !collapsed && onToggle && (
        <button
          type="button"
          className="chat-toggle"
          onClick={onToggle}
          aria-expanded="true"
          aria-controls={messagesId}
        >
          <span className="chat-toggle-chevron" aria-hidden="true">▼</span>
          <span>الشات</span>
          {messageCount > 0 && (
            <span className="chat-toggle-badge" aria-live="polite" aria-atomic="true">
              {messageCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}