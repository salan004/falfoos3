import { apiFetch } from './api';

/**
 * Phase 7 / Step 3 — thin typed wrapper over the EXISTING website tournament
 * ticket purchase endpoints. It only moves DTOs through `apiFetch`; it never
 * derives a price, touches Streamlabs, signs anything, or registers a
 * participant locally.
 *
 * Endpoints (server-owned contract, unchanged):
 *   POST /api/integrations/purchase         { tournament_id, game_id }
 *   POST /api/integrations/purchase/status  { request_id }
 */

export type PurchaseStatus =
  | 'INTENT_CREATED'
  | 'BOT_REQUESTED'
  | 'BOT_DEBIT_CONFIRMED'
  | 'PARTICIPANT_REGISTERED'
  | 'FAILED'
  | 'REFUND_REQUESTED'
  | 'REFUNDED'
  | 'PENDING_RECOVERY';

export interface PurchaseResult {
  request_id: string;
  status: PurchaseStatus;
  player_id: string;
  /** Price actually charged by the bot; only known AFTER a confirmed debit. */
  amount?: number | null;
  balance_after?: number | null;
  error?: string | null;
}

export interface PurchaseFailure {
  /** HTTP status, or 0 for a transport/network failure. */
  status: number;
  /** Stable server machine code (or `network_error`). */
  code: string;
  message: string;
}

export type PurchaseResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: PurchaseFailure };

async function purchaseRequest<T>(path: string, body: Record<string, unknown>): Promise<PurchaseResponse<T>> {
  try {
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) {
      const err = (parsed ?? {}) as { error?: unknown; message?: unknown };
      return {
        ok: false,
        error: {
          status: res.status,
          code: typeof err.error === 'string' ? err.error : 'request_failed',
          message: typeof err.message === 'string' ? err.message : '',
        },
      };
    }
    return { ok: true, data: parsed as T };
  } catch {
    return { ok: false, error: { status: 0, code: 'network_error', message: '' } };
  }
}

/**
 * Starts (or resumes) a purchase. The server owns the price, the debit, the
 * Player identity and idempotency — only the tournament + its game are sent.
 */
export function startPurchase(
  tournamentId: string,
  gameId: string
): Promise<PurchaseResponse<PurchaseResult>> {
  return purchaseRequest<PurchaseResult>('/api/integrations/purchase', {
    tournament_id: tournamentId,
    game_id: gameId,
  });
}

/** Polls a durable purchase intent (safe across refresh/retry). */
export function fetchPurchaseStatus(requestId: string): Promise<PurchaseResponse<PurchaseResult>> {
  return purchaseRequest<PurchaseResult>('/api/integrations/purchase/status', {
    request_id: requestId,
  });
}
