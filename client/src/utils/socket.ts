import { io, Socket } from 'socket.io-client';
import { ensureGuestIdentity } from '../hooks/useGuestIdentity';

let socket: Socket | null = null;

// Phase 11E — the server resolves every handshake from HTTP cookies and
// REJECTS connections without an identity. Start the (memoized) identity
// fetch as early as possible; the connect_error handler below covers the
// race where the socket wins the fetch.
void ensureGuestIdentity().catch(() => undefined);

export function getSocket(): Socket {
  if (!socket) {
    socket = io((import.meta.env.VITE_WS_URL || ''), {
      transports: ['websocket', 'polling'],
    });
    socket.on('connect_error', (err) => {
      if ((err as Error)?.message === 'identity-required') {
        void ensureGuestIdentity()
          .then(() => {
            socket?.connect();
          })
          .catch(() => undefined);
      }
    });
  }
  return socket;
}

export function sendAdminCommand(command: string, payload?: unknown): void {
  const s = getSocket();
  s.emit('admin:command', { command, payload });
}

/**
 * Phase 9A: per-connection admin handshake. The token is submitted at runtime
 * (never baked into the bundle) and only authorizes THIS socket until it
 * disconnects. `onAdminAuthResult` receives the server's verdict.
 */
export function sendAdminAuth(token: string): void {
  getSocket().emit('admin:auth', { token });
}

export function onAdminAuthResult(handler: (result: { ok: boolean }) => void): () => void {
  const s = getSocket();
  const listener = (payload: unknown) => handler(payload as { ok: boolean });
  s.on('admin:authResult', listener);
  return () => {
    s.off('admin:authResult', listener);
  };
}

export function onAdminError(handler: (payload: { message?: string; action?: string }) => void): () => void {
  const s = getSocket();
  const listener = (payload: unknown) => handler(payload as { message?: string; action?: string });
  s.on('admin:error', listener);
  return () => {
    s.off('admin:error', listener);
  };
}

export function sendChatMessage(author: string, authorId: string, message: string): void {
  const s = getSocket();
  s.emit('chat:message', { author, authorId, message });
}

export function sendYouTubeConnect(videoId: string): void {
  const s = getSocket();
  s.emit('youtube:connect', { videoId });
}

export function sendYouTubeDisconnect(): void {
  const s = getSocket();
  s.emit('youtube:disconnect', {});
}
