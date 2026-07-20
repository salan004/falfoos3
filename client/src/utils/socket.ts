import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/', {
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function sendAdminCommand(command: string, payload?: unknown): void {
  const s = getSocket();
  s.emit('admin:command', { command, payload });
}

export function sendChatMessage(author: string, authorId: string, message: string): void {
  const s = getSocket();
  s.emit('chat:message', { author, authorId, message });
}
