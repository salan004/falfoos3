import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

/**
 * Phase 3 — HMAC verification for bot webhook endpoint.
 *
 * Verifies the X-FalFoos-Signature header against the raw request body.
 * Signature format: t=<timestamp>,v1=<hex_signature>
 * Signature = HMAC-SHA256(BOT_WEBHOOK_SECRET, timestamp + "." + rawBody)
 */

export interface ParsedSignature {
  timestamp: number;
  signature: string;
}

export function parseSignatureHeader(header: string | undefined): ParsedSignature | null {
  if (!header) return null;
  const parts = header.split(',');
  let timestamp: number | null = null;
  let signature: string | null = null;
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = parseInt(value, 10);
    if (key === 'v1') signature = value;
  }
  if (timestamp === null || signature === null) return null;
  if (isNaN(timestamp)) return null;
  return { timestamp, signature };
}

export function verifyHmacSignature(rawBody: Buffer | string, timestamp: number, signature: string): boolean {
  const secret = env.BOT_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[BotWebhook] BOT_WEBHOOK_SECRET not configured');
    return false;
  }
  const bodyString = rawBody instanceof Buffer ? rawBody.toString('utf8') : rawBody;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${bodyString}`)
    .digest('hex');
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function isTimestampFresh(timestamp: number, maxAgeMs = 300000): boolean {
  const now = Date.now();
  // The bot sends the timestamp in Unix seconds; convert to milliseconds before
  // comparing against Date.now(). The HMAC itself is computed over the exact
  // value sent by the bot, so this only affects the replay window.
  return Math.abs(now - timestamp * 1000) <= maxAgeMs;
}

/**
 * Middleware to verify bot webhook HMAC signature.
 * Requires raw body to be available on req.rawBody (set by express.json verify option).
 */
export function verifyBotWebhook(req: Request, res: Response, next: NextFunction): void {
  const signatureHeader = req.headers['x-falfoos-signature'];
  const parsed = parseSignatureHeader(signatureHeader as string | undefined);

  if (!parsed) {
    res.status(400).json({ error: 'invalid_signature_header', message: 'Missing or malformed X-FalFoos-Signature header' });
    return;
  }

  const { timestamp, signature } = parsed;

  if (!isTimestampFresh(timestamp)) {
    res.status(400).json({ error: 'stale_timestamp', message: 'Request timestamp outside allowed window' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('[BotWebhook] Raw body not available for HMAC verification');
    res.status(500).json({ error: 'server_configuration_error', message: 'Raw body capture not configured' });
    return;
  }

  if (!verifyHmacSignature(rawBody, timestamp, signature)) {
    res.status(401).json({ error: 'invalid_signature', message: 'HMAC signature verification failed' });
    return;
  }

  next();
}

/**
 * Middleware to capture raw request body for HMAC verification.
 * Must be used with express.json({ verify: captureRawBody })
 */
export function captureRawBody(req: Request, res: Response, buf: Buffer): void {
  (req as any).rawBody = buf;
}