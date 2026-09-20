import { apiFetch } from './api';

/**
 * Phase 7 / Step 2 — thin typed wrapper over the EXISTING website <-> bot
 * account-linking endpoints. It only moves DTOs through `apiFetch`
 * (credentials included); it never resolves identity, verifies signatures,
 * talks to YouTube/Streamlabs, or chooses a Player.
 *
 * Endpoints (server-owned contract):
 *   GET  /api/integrations/account
 *   POST /api/integrations/link/start   { channel, operation }
 *   POST /api/integrations/link/verify  { request_id }
 */

/**
 * Phase 8 — the two explicit account operations. The server decides the final
 * outcome after verifying the signed YouTube attestation; the browser only
 * states which operation the user chose.
 */
export type AccountLinkOperation = 'LINK_EXISTING_PLAYER' | 'REGISTER_NEW_PLAYER';

export interface LinkedPlayer {
  player_id: string;
  youtube_channel_id: string;
  display_name: string | null;
}

export interface AccountLinkStatus {
  linked: boolean;
  player: LinkedPlayer | null;
}

export interface LinkStartResult {
  request_id: string;
  challenge_id: string;
  code: string;
  expires_at: number | null;
  youtube_channel_id: string;
  youtube_name: string | null;
}

export interface LinkVerifyResult {
  status: 'CLAIMED';
  player_id: string;
  youtube_channel_id: string;
  youtube_name: string | null;
}

export interface AccountLinkFailure {
  /** HTTP status, or 0 for a transport/network failure. */
  status: number;
  /** Stable server machine code (or `network_error`). */
  code: string;
  message: string;
}

export type AccountLinkResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: AccountLinkFailure };

async function accountLinkRequest<T>(
  path: string,
  init?: RequestInit
): Promise<AccountLinkResponse<T>> {
  try {
    const res = await apiFetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
    const text = await res.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    if (!res.ok) {
      const parsed = (body ?? {}) as { error?: unknown; message?: unknown };
      return {
        ok: false,
        error: {
          status: res.status,
          code: typeof parsed.error === 'string' ? parsed.error : 'request_failed',
          message: typeof parsed.message === 'string' ? parsed.message : '',
        },
      };
    }
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: { status: 0, code: 'network_error', message: '' } };
  }
}

/** Current account link state (authenticated session cookie required). */
export function fetchAccountLinkStatus(): Promise<AccountLinkResponse<AccountLinkStatus>> {
  return accountLinkRequest<AccountLinkStatus>('/api/integrations/account');
}

/**
 * Starts an account operation for the authenticated account. `channel` and
 * `operation` are the only client-supplied values; the server owns the request
 * id, validates the operation against its allowlist, and resolves/validates the
 * channel with the bot.
 */
export function startAccountLink(
  channel: string,
  operation: AccountLinkOperation
): Promise<AccountLinkResponse<LinkStartResult>> {
  return accountLinkRequest<LinkStartResult>('/api/integrations/link/start', {
    method: 'POST',
    body: JSON.stringify({ channel, operation }),
  });
}

/** Verifies the channel challenge and claims the EXISTING Player server-side. */
export function verifyAccountLink(requestId: string): Promise<AccountLinkResponse<LinkVerifyResult>> {
  return accountLinkRequest<LinkVerifyResult>('/api/integrations/link/verify', {
    method: 'POST',
    body: JSON.stringify({ request_id: requestId }),
  });
}
