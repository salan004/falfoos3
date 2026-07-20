import { useEffect, useRef } from 'react';
import { ChatMessage } from '../types/game';

interface YouTubeChatFeedProps {
  messages: ChatMessage[];
}

export function YouTubeChatFeed({ messages }: YouTubeChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div
      className="panel"
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--text-muted)',
          marginBottom: '6px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}
      >
        Live Chat Feed
      </div>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '20px' }}>
            Waiting for chat messages...
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className="animate-fade-in"
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'var(--bg-card)',
              fontSize: '0.8rem',
            }}
          >
            <span style={{ color: 'var(--neon-cyan)', fontWeight: 600, marginRight: '6px' }}>
              {msg.author}
            </span>
            <span style={{ color: 'var(--text-primary)' }}>{msg.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
