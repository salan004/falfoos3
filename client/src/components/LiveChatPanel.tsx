import { useEffect, useRef, useState } from 'react';
import { ChatMessage, YouTubeConnectionStatus } from '../types/game';
import { ConnectionStatusPill } from './ConnectionStatusPill';

interface LiveChatPanelProps {
  messages: ChatMessage[];
  status: YouTubeConnectionStatus;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return new Date(ts).toLocaleTimeString();
  }
}

export function LiveChatPanel({ messages, status }: LiveChatPanelProps) {
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

  return (
    <div className="glass live-chat h-full flex flex-col" style={{ minHeight: 0 }}>
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 border-b border-[var(--border-color)]">
        <h3 className="text-sm font-extrabold" style={{ color: 'var(--text-primary)' }}>
          💬 دردشة البث المباشر
        </h3>
        <ConnectionStatusPill status={status} compact />
      </div>

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
                className="w-9 h-9 rounded-full object-cover shrink-0 mt-0.5"
                style={{ border: '1px solid var(--border-color)' }}
              />
            ) : (
              <div
                className="w-9 h-9 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-sm font-bold"
                style={{
                  color: 'var(--neon-cyan)',
                  background: 'rgba(0,240,255,0.07)',
                  border: '1px solid rgba(0,240,255,0.22)',
                }}
              >
                {msg.author.slice(0, 1)}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[0.8rem] font-bold truncate max-w-[160px]" style={{ color: 'var(--neon-cyan)' }}>
                  {msg.author}
                </span>
                {msg.isModerator === true && (
                  <span className="badge badge-green" style={{ fontSize: '0.55rem', padding: '1px 5px' }}>
                    🛡️ مشرف
                  </span>
                )}
                <span className="text-[0.65rem] ms-auto shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {formatTime(msg.timestamp)}
                </span>
              </div>
              <div className="text-sm break-words leading-relaxed mt-0.5" style={{ color: 'var(--text-primary)' }}>
                {msg.message}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div
        className="px-4 py-2 text-[0.68rem] text-center border-t border-[var(--border-color)]"
        style={{ color: 'var(--text-muted)' }}
      >
        التفاعل مع الألعاب يتم عبر أوامر دردشة يوتيوب مباشرة
      </div>
    </div>
  );
}
