import { io, Socket } from 'socket.io-client';
import { ensureGuestIdentity } from '../hooks/useGuestIdentity';

let socket: Socket | null = null;

const identityReady = ensureGuestIdentity().catch(() => undefined);

export function getSocket(): Socket {
  if (!socket) {
    socket = io((import.meta.env.VITE_WS_URL || ''), {
      transports: ['polling', 'websocket'],
      withCredentials: true,
      autoConnect: false,
    });

    void identityReady.then(() => {
      if (socket && !socket.connected) {
        socket.connect();
      }
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] connect_error:', err.message);

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

export function sendAdminCommand(
  command: string,
  payload?: unknown
): void {
  const s = getSocket();
  s.emit('admin:command', { command, payload });
}

export function sendAdminAuth(token: string): void {
  getSocket().emit('admin:auth', { token });
}

export function onAdminAuthResult(
  handler: (result: { ok: boolean }) => void
): () => void {
  const s = getSocket();

  const listener = (payload: unknown) => {
    handler(payload as { ok: boolean });
  };

  s.on('admin:authResult', listener);

  return () => {
    s.off('admin:authResult', listener);
  };
}

export function onAdminError(
  handler: (payload: {
    message?: string;
    action?: string;
  }) => void
): () => void {
  const s = getSocket();

  const listener = (payload: unknown) => {
    handler(payload as {
      message?: string;
      action?: string;
    });
  };

  s.on('admin:error', listener);

  return () => {
    s.off('admin:error', listener);
  };
}

export function sendChatMessage(
  author: string,
  authorId: string,
  message: string
): void {
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
