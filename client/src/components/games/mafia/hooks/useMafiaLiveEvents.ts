import { useRef, useState } from 'react';
import { useSocketEvent } from '../../../../hooks/useWebSocket';
import type { MafiaVotingResultSnapshot, MafiaVoteTally } from '../../../../types/game';

export interface MafiaPhaseWindow {
  phaseKind: 'night' | 'day' | 'voting';
  round: number;
  durationMs: number;
  endsAt: number;
  totalSeconds: number;
}

export interface MafiaRolesSummary {
  playerCount: number;
  mafiaCount: number;
  hasDoctor: boolean;
  hasDetective: boolean;
}

export type MafiaLiveNotice =
  | {
      id: number;
      kind: 'nightResult';
      at: number;
      eliminated: string | null;
      protectedPlayer: string | null;
      message: string;
    }
  | { id: number; kind: 'notEnoughPlayers'; at: number; count: number; required: number };

export interface MafiaPrivateMessageEntry {
  id: number;
  at: number;
  playerId: string;
  message: string;
}

export interface MafiaLiveEvents {
  roleRevealOpen: boolean;
  activeWindow: MafiaPhaseWindow | null;
  votingResult: MafiaVotingResultSnapshot | null;
  rolesSummary: MafiaRolesSummary | null;
  notices: MafiaLiveNotice[];
  privateMessages: MafiaPrivateMessageEntry[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function applyWindow(
  setter: (w: MafiaPhaseWindow | null) => void,
  phaseKind: MafiaPhaseWindow['phaseKind'],
  raw: Record<string, unknown>
): void {
  const round = readNumber(raw.round);
  const durationMs = Math.max(0, readNumber(raw.duration));
  setter({
    phaseKind,
    round,
    durationMs,
    endsAt: Date.now() + durationMs,
    totalSeconds: Math.max(1, Math.round(durationMs / 1000)),
  });
}

function readVoteTally(item: unknown): MafiaVoteTally | null {
  const o = asRecord(item);
  const playerId = readString(o.playerId);
  const playerName = readString(o.playerName);
  if (!playerId || !playerName) return null;
  return { playerId, playerName, votes: readNumber(o.votes) };
}

function readVotingResult(raw: Record<string, unknown>): MafiaVotingResultSnapshot {
  const list = Array.isArray(raw.votes) ? raw.votes : [];
  return {
    votes: list
      .map(readVoteTally)
      .filter((t): t is MafiaVoteTally => t !== null),
    eliminated: readStringOrNull(raw.eliminated),
    tie: raw.tie === true,
    message: readString(raw.message),
  };
}

const MAX_NOTICES = 5;
const MAX_PRIVATE_MESSAGES = 20;

export function useMafiaLiveEvents(): MafiaLiveEvents {
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  const [roleRevealOpen, setRoleRevealOpen] = useState(false);
  const [activeWindow, setActiveWindow] = useState<MafiaPhaseWindow | null>(null);
  const [votingResult, setVotingResult] = useState<MafiaVotingResultSnapshot | null>(null);
  const [rolesSummary, setRolesSummary] = useState<MafiaRolesSummary | null>(null);
  const [notices, setNotices] = useState<MafiaLiveNotice[]>([]);
  const [privateMessages, setPrivateMessages] = useState<MafiaPrivateMessageEntry[]>([]);

  useSocketEvent('mafia:rolesAssigned', (raw) => {
    const o = asRecord(raw);
    setRolesSummary({
      playerCount: readNumber(o.playerCount),
      mafiaCount: readNumber(o.mafiaCount),
      hasDoctor: o.hasDoctor === true,
      hasDetective: o.hasDetective === true,
    });
    setRoleRevealOpen(true);
  });

  useSocketEvent('mafia:nightStarted', (raw) => {
    setRoleRevealOpen(false);
    applyWindow(setActiveWindow, 'night', asRecord(raw));
  });

  useSocketEvent('mafia:dayStarted', (raw) => {
    applyWindow(setActiveWindow, 'day', asRecord(raw));
  });

  useSocketEvent('mafia:votingStarted', (raw) => {
    setVotingResult(null);
    applyWindow(setActiveWindow, 'voting', asRecord(raw));
  });

  useSocketEvent('mafia:votingResult', (raw) => {
    setVotingResult(readVotingResult(asRecord(raw)));
  });

  useSocketEvent('mafia:nightResult', (raw) => {
    const o = asRecord(raw);
    setNotices((prev) =>
      [
        ...prev,
        {
          id: nextId(),
          kind: 'nightResult' as const,
          at: Date.now(),
          eliminated: readStringOrNull(o.eliminated),
          protectedPlayer: readStringOrNull(o.protected),
          message: readString(o.message),
        },
      ].slice(-MAX_NOTICES)
    );
  });

  useSocketEvent('mafia:notEnoughPlayers', (raw) => {
    const o = asRecord(raw);
    setNotices((prev) =>
      [
        ...prev,
        {
          id: nextId(),
          kind: 'notEnoughPlayers' as const,
          at: Date.now(),
          count: readNumber(o.count),
          required: readNumber(o.required),
        },
      ].slice(-MAX_NOTICES)
    );
  });

  useSocketEvent('mafia:privateMessage', (raw) => {
    const o = asRecord(raw);
    const message = readString(o.message);
    if (!message) return;
    setPrivateMessages((prev) =>
      [
        ...prev,
        {
          id: nextId(),
          at: Date.now(),
          playerId: readString(o.playerId),
          message,
        },
      ].slice(-MAX_PRIVATE_MESSAGES)
    );
  });

  return {
    roleRevealOpen,
    activeWindow,
    votingResult,
    rolesSummary,
    notices,
    privateMessages,
  };
}
