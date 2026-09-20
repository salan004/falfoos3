import crypto from 'crypto';
import { env } from '../config/env';

/**
 * Phase 7 — server-only client for the FalFoos Bot "Website Integration Layer".
 *
 * The bot exposes an isolated, authenticated surface at /api/v1/website/*.
 * Every request is signed with a shared secret and every JSON response is
 * signed back by the bot, so the website never trusts a bare HTTP 200.
 *
 *   X-FalFoos-Signature:          t=<unix_seconds>,v1=<hex hmac-sha256>
 *   signature = HMAC_SHA256(SECRET, `${timestamp}.${rawBody}`)
 *   X-FalFoos-Response-Signature: same construction over the response body.
 *
 * The SECRET (WEBSITE_INTEGRATION_SECRET) lives only here, server-side. It is
 * never sent to the browser, never logged, and never returned by any route.
 */

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_SKEW_MS = 5 * 60 * 1000;
const ATTESTATION_PREFIX = 'FalfoosWebsiteAttestationV1';

export type BotErrorCode =
  | 'integration_not_configured'
  | 'bot_unreachable'
  | 'invalid_bot_signature'
  | 'bot_timeout'
  | 'bot_unexpected_response';

export class BotIntegrationError extends Error {
  readonly code: BotErrorCode;
  readonly httpStatus: number;
  readonly botStatus: number | null;

  constructor(code: BotErrorCode, httpStatus: number, message: string, botStatus: number | null = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.botStatus = botStatus;
  }
}

export interface ParsedSignature {
  timestamp: number;
  signature: string;
}

export interface BotResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

export function hmacHex(secret: string, message: string): string {
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

export function buildSignatureHeader(
  secret: string,
  bodyString: string,
  timestamp: number = Math.floor(Date.now() / 1000)
): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${bodyString}`)}`;
}

export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (typeof header !== 'string' || header.length === 0) return null;
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') {
      const n = parseInt(value, 10);
      if (Number.isFinite(n)) timestamp = n;
    } else if (key === 'v1') {
      signature = value;
    }
  }
  if (timestamp === null || !signature) return null;
  return { timestamp, signature };
}

function timingSafeHexEqual(expectedHex: string, providedHex: string): boolean {
  if (typeof expectedHex !== 'string' || typeof providedHex !== 'string') return false;
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expectedHex, 'hex');
    b = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verifies the bot's signed response body. The signature covers the RAW
 * response text (not a re-serialized object) and must be within the skew
 * window, so a captured response cannot be replayed later.
 */
export function verifyResponseSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;
  if (Math.abs(Date.now() - parsed.timestamp * 1000) > MAX_SKEW_MS) return false;
  const expected = hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  return timingSafeHexEqual(expected, parsed.signature);
}

export interface WebsiteAttestation {
  request_id: string;
  youtube_channel_id: string;
  youtube_name: string;
  platform: string;
  platform_id: string;
  loyalty_id: string | null;
  points: number;
  attested_at: number;
}

/** The exact canonical string the bot signs for an identity attestation. */
export function canonicalAttestation(att: WebsiteAttestation): string {
  return [
    ATTESTATION_PREFIX,
    String(att.request_id ?? ''),
    String(att.youtube_channel_id ?? ''),
    String(att.youtube_name ?? ''),
    String(att.platform ?? ''),
    String(att.platform_id ?? ''),
    String(att.loyalty_id ?? ''),
    String(att.points ?? ''),
    String(att.attested_at ?? ''),
  ].join('\n');
}

/** Recomputes the bot's deterministic attestation signature (transport-independent). */
export function verifyAttestationSignature(
  att: WebsiteAttestation,
  providedSignature: string | null | undefined,
  secret: string
): boolean {
  if (typeof providedSignature !== 'string' || providedSignature.length === 0) return false;
  const expected = hmacHex(secret, canonicalAttestation(att));
  return timingSafeHexEqual(expected, providedSignature);
}

export function isBotConfigured(): boolean {
  return Boolean(env.FALFOOS_BOT_URL && env.WEBSITE_INTEGRATION_SECRET);
}

function baseUrl(): string {
  return (env.FALFOOS_BOT_URL || '').replace(/\/+$/, '');
}

/**
 * Calls a bot integration endpoint with a signed body and verifies the signed
 * response. Throws BotIntegrationError on transport failure or invalid
 * signature — callers must never treat a bare 200 as success.
 */
export async function callBot<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<BotResponse<T>> {
  const secret = env.WEBSITE_INTEGRATION_SECRET;
  const base = baseUrl();
  if (!secret || !base) {
    throw new BotIntegrationError(
      'integration_not_configured',
      503,
      'WEBSITE_INTEGRATION_SECRET or FALFOOS_BOT_URL is not configured'
    );
  }

  const bodyString = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-FalFoos-Signature': buildSignatureHeader(secret, bodyString, timestamp),
  };
  if (typeof body.request_id === 'string' && body.request_id.length > 0) {
    headers['Idempotency-Key'] = body.request_id;
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: bodyString,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(message);
    throw new BotIntegrationError(
      isTimeout ? 'bot_timeout' : 'bot_unreachable',
      502,
      `Could not reach FalFoos bot: ${message}`
    );
  }

  const raw = await res.text();
  const responseSig = res.headers.get('x-falfoos-response-signature');
  if (!verifyResponseSignature(raw, responseSig, secret)) {
    throw new BotIntegrationError(
      'invalid_bot_signature',
      502,
      'Bot response signature verification failed',
      res.status
    );
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new BotIntegrationError('bot_unexpected_response', 502, 'Bot returned a non-JSON response', res.status);
  }

  return { status: res.status, body: parsed as T };
}

export const BOT_ENDPOINTS = {
  health: '/api/v1/website/health',
  linkStart: '/api/v1/website/link/start',
  linkVerify: '/api/v1/website/link/verify',
  purchase: '/api/v1/website/purchase',
  refund: '/api/v1/website/purchase/refund',
} as const;

export interface BotHealth {
  ok: boolean;
  integration: boolean;
}

/**
 * Phase 7 (M3) — Bot health probe.
 *
 * The Bot exposes `/api/v1/website/health` as an unauthenticated GET liveness
 * endpoint (`src/website/routes.js`): no request body, no HMAC request
 * signature, and an unsigned plain-JSON `{ ok, integration }` response.
 * `callBot()` always POSTs a signed body and requires a signed response, so it
 * must NOT be used for this endpoint. This dedicated path follows the real
 * contract without changing `callBot()` (purchase / link / refund unchanged).
 */
export async function health(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<BotResponse<BotHealth>> {
  const base = baseUrl();
  if (!base) {
    throw new BotIntegrationError('integration_not_configured', 503, 'FALFOOS_BOT_URL is not configured');
  }

  let res: Response;
  try {
    res = await fetch(`${base}${BOT_ENDPOINTS.health}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(message);
    throw new BotIntegrationError(
      isTimeout ? 'bot_timeout' : 'bot_unreachable',
      502,
      `Could not reach FalFoos bot: ${message}`
    );
  }

  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new BotIntegrationError('bot_unexpected_response', 502, 'Bot returned a non-JSON response', res.status);
  }
  return { status: res.status, body: parsed as BotHealth };
}

export const ATTESTATION_PREFIX_VALUE = ATTESTATION_PREFIX;
