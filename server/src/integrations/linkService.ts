import crypto from 'crypto';
import { getDb } from '../db/db';
import { env } from '../config/env';
import { findCanonicalPlayerIdByChannel } from '../identity/identityService';
import { claimGuestForUser, type ClaimCheckOutcome } from '../auth/claiming';
import { ensureUserCanonicalPlayer } from '../auth/socketIdentity';
import type { SessionUser } from '../auth/session';
import { IntegrationError } from './errors';
import {
  callBot,
  verifyAttestationSignature,
  BOT_ENDPOINTS,
  type WebsiteAttestation,
} from './falfoosBotClient';

/**
 * Phase 7 — account -> existing Player linking.
 *
 * Flow: authenticated website user -> bot /link/start (channel challenge) ->
 * user places the code in the YouTube channel description -> bot /link/verify
 * (YouTube Data API + Streamlabs loyalty) -> signed attestation -> website
 * verifies the signature, resolves the EXISTING canonical Player, and performs
 * the atomic `claimed_user_id` claim.
 *
 * The website NEVER accepts a client-supplied player id, and never creates a
 * `user:<id>` Player. Live Chat is not involved.
 */

type LinkStatus = 'CREATED' | 'CHALLENGE_ISSUED' | 'VERIFIED' | 'CLAIMED' | 'FAILED';

interface LinkIntentRow {
  request_id: string;
  website_user_id: string;
  challenge_id: string | null;
  youtube_channel_id: string | null;
  youtube_name: string | null;
  status: LinkStatus;
  attestation_json: string | null;
  error: string | null;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

function getIntent(requestId: string): LinkIntentRow | null {
  const row = getDb()
    .prepare('SELECT * FROM link_intents WHERE request_id = ?')
    .get(requestId) as LinkIntentRow | undefined;
  return row ?? null;
}

function insertIntent(requestId: string, userId: string): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO link_intents (request_id, website_user_id, status, created_at, updated_at)
       VALUES (?, ?, 'CREATED', ?, ?)`
    )
    .run(requestId, userId, now, now);
}

function updateIntent(requestId: string, fields: Record<string, unknown>): void {
  const allowed = [
    'challenge_id',
    'youtube_channel_id',
    'youtube_name',
    'status',
    'attestation_json',
    'error',
    'expires_at',
  ];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = ?`);
      params.push(fields[key]);
    }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  params.push(Date.now());
  params.push(requestId);
  getDb().prepare(`UPDATE link_intents SET ${sets.join(', ')} WHERE request_id = ?`).run(...params);
}

export interface LinkStartResult {
  request_id: string;
  challenge_id: string;
  code: string;
  expires_at: number | null;
  youtube_channel_id: string;
  youtube_name: string | null;
}

/** Begins linking: creates a durable intent and asks the bot for a challenge. */
export async function startLink(user: SessionUser, channel: string): Promise<LinkStartResult> {
  const channelInput = typeof channel === 'string' ? channel.trim() : '';
  if (!channelInput) throw new IntegrationError('invalid_channel', 400, 'channel is required');

  const requestId = crypto.randomUUID();
  insertIntent(requestId, user.id);

  let bot;
  try {
    bot = await callBot<{
      request_id?: string;
      challenge_id?: string;
      code?: string;
      expires_at?: number;
      youtube_channel_id?: string;
      youtube_name?: string;
      error?: string;
      message?: string;
    }>(BOT_ENDPOINTS.linkStart, {
      request_id: requestId,
      website_user_id: user.id,
      channel: channelInput,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateIntent(requestId, { status: 'FAILED', error: message });
    throw err;
  }

  const body = bot.body as {
    challenge_id?: string;
    code?: string;
    expires_at?: number;
    youtube_channel_id?: string;
    youtube_name?: string;
    error?: string;
  };
  if (bot.status !== 200 || !body.challenge_id || !body.code || !body.youtube_channel_id) {
    const error = body.error || 'link_start_failed';
    updateIntent(requestId, { status: 'FAILED', error });
    throw new IntegrationError(error, 502, `Bot rejected link/start (${error})`);
  }

  updateIntent(requestId, {
    status: 'CHALLENGE_ISSUED',
    challenge_id: body.challenge_id,
    youtube_channel_id: body.youtube_channel_id,
    youtube_name: body.youtube_name ?? null,
    expires_at: body.expires_at ?? null,
  });

  return {
    request_id: requestId,
    challenge_id: body.challenge_id,
    code: body.code,
    expires_at: body.expires_at ?? null,
    youtube_channel_id: body.youtube_channel_id,
    youtube_name: body.youtube_name ?? null,
  };
}

export interface LinkVerifyResult {
  status: 'CLAIMED';
  player_id: string;
  youtube_channel_id: string;
  youtube_name: string | null;
}

/**
 * Phase 7 / Step 5F (F2) — classifies ONLY the expected one-user <-> one-Player
 * ownership conflict raised while claiming: the claim guard losing to another
 * account (`claimedByOther`) or the `0025` partial UNIQUE index
 * (`guests.claimed_user_id`) rejecting a concurrent claim. Any other error
 * (including a UNIQUE failure on a different column) must stay unexpected so it
 * is never mis-reported as a 409.
 */
export function isClaimOwnershipConflict(err: unknown): boolean {
  if (err instanceof Error && err.message === 'claimedByOther') return true;
  const candidate = (err ?? {}) as { code?: unknown; message?: unknown };
  const message = err instanceof Error ? err.message : candidate.message;
  return (
    candidate.code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    typeof message === 'string' &&
    /UNIQUE constraint failed:\s*guests\.claimed_user_id/i.test(message)
  );
}

/** Verifies the bot attestation and atomically claims the EXISTING Player. */
export async function verifyLink(user: SessionUser, requestId: string): Promise<LinkVerifyResult> {
  const id = typeof requestId === 'string' ? requestId.trim() : '';
  if (!id) throw new IntegrationError('invalid_request_id', 400, 'request_id is required');

  const intent = getIntent(id);
  if (!intent) throw new IntegrationError('link_request_not_found', 404, 'Unknown link request');
  if (intent.website_user_id !== user.id) {
    throw new IntegrationError('link_request_forbidden', 403, 'Link request belongs to a different account');
  }

  // Idempotent replay of a completed link.
  if (intent.status === 'CLAIMED' && intent.youtube_channel_id) {
    const playerId = findCanonicalPlayerIdByChannel(intent.youtube_channel_id);
    if (playerId) {
      return {
        status: 'CLAIMED',
        player_id: playerId,
        youtube_channel_id: intent.youtube_channel_id,
        youtube_name: intent.youtube_name,
      };
    }
  }
  if (intent.status === 'FAILED') {
    throw new IntegrationError('link_request_failed', 409, intent.error || 'Link request failed');
  }
  if (!intent.challenge_id) {
    throw new IntegrationError('link_challenge_missing', 409, 'No challenge issued for this request');
  }
  if (intent.expires_at !== null && Date.now() > intent.expires_at) {
    updateIntent(id, { status: 'FAILED', error: 'challenge_expired' });
    throw new IntegrationError('challenge_expired', 410, 'Verification challenge expired');
  }

  const secret = env.WEBSITE_INTEGRATION_SECRET;
  if (!secret) throw new IntegrationError('integration_not_configured', 503, 'Integration secret is not configured');

  // Phase 8 (M1) — the Bot request store treats `request_id` as an
  // operation-scoped key: reusing the link/start request id here would collide
  // with the existing `identity_link_start` row and return 409
  // request_id_conflict. Generate an independent id for the Bot verify
  // operation; the Website link intent keeps its own `id` for correlation.
  const botRequestId = crypto.randomUUID();

  let bot;
  try {
    bot = await callBot<Record<string, unknown>>(BOT_ENDPOINTS.linkVerify, {
      request_id: botRequestId,
      challenge_id: intent.challenge_id,
      website_user_id: user.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateIntent(id, { status: 'FAILED', error: message });
    throw err;
  }

  const body = bot.body as unknown as WebsiteAttestation & {
    attestation_signature?: string;
    attestation_algorithm?: string;
    error?: string;
  };

  if (bot.status !== 200 || !body.youtube_channel_id || !body.attestation_signature) {
    const error = (bot.body as { error?: string }).error || 'link_verify_failed';
    updateIntent(id, { status: 'FAILED', error });
    throw new IntegrationError(error, 502, `Bot rejected link/verify (${error})`);
  }

  // --- Attestation validation (never trust HTTP 200 alone) -----------------
  if (body.attestation_algorithm !== 'HMAC-SHA256') {
    updateIntent(id, { status: 'FAILED', error: 'invalid_attestation_algorithm' });
    throw new IntegrationError('invalid_attestation_algorithm', 502, 'Unexpected attestation algorithm');
  }
  if (body.request_id !== botRequestId) {
    updateIntent(id, { status: 'FAILED', error: 'attestation_request_mismatch' });
    throw new IntegrationError('attestation_request_mismatch', 502, 'Attestation request mismatch');
  }
  if (intent.youtube_channel_id && body.youtube_channel_id !== intent.youtube_channel_id) {
    updateIntent(id, { status: 'FAILED', error: 'attestation_channel_mismatch' });
    throw new IntegrationError('attestation_channel_mismatch', 502, 'Attestation channel mismatch');
  }
  if (String(body.platform || '').toLowerCase() !== 'youtube' || body.platform_id !== body.youtube_channel_id) {
    updateIntent(id, { status: 'FAILED', error: 'attestation_platform_mismatch' });
    throw new IntegrationError('attestation_platform_mismatch', 502, 'Attestation platform mismatch');
  }
  const att: WebsiteAttestation = {
    request_id: body.request_id,
    youtube_channel_id: body.youtube_channel_id,
    youtube_name: body.youtube_name,
    platform: body.platform,
    platform_id: body.platform_id,
    loyalty_id: body.loyalty_id ?? null,
    points: Number(body.points ?? 0),
    attested_at: Number(body.attested_at ?? 0),
  };
  if (!verifyAttestationSignature(att, body.attestation_signature, secret)) {
    updateIntent(id, { status: 'FAILED', error: 'invalid_attestation_signature' });
    throw new IntegrationError('invalid_attestation_signature', 502, 'Attestation signature verification failed');
  }

  // --- Resolve the EXISTING canonical Player (never create silently) -------
  const playerId = findCanonicalPlayerIdByChannel(body.youtube_channel_id);
  if (!playerId) {
    updateIntent(id, { status: 'FAILED', error: 'player_not_found' });
    throw new IntegrationError(
      'player_not_found',
      404,
      'No FalFoos Player exists for this YouTube channel yet'
    );
  }

  // --- One account <-> one Player (explicit, no silent replacement) --------
  const existingClaimed = ensureUserCanonicalPlayer(user);
  if (existingClaimed && existingClaimed !== playerId) {
    updateIntent(id, { status: 'FAILED', error: 'account_already_linked' });
    throw new IntegrationError(
      'account_already_linked',
      409,
      'This account is already linked to a different Player; manual resolution is required'
    );
  }

  // --- Atomic claim (reuses the Phase 11D primitive unchanged) -------------
  let outcome: ClaimCheckOutcome;
  try {
    outcome = claimGuestForUser(user, body.youtube_channel_id, body.youtube_name || body.youtube_channel_id);
  } catch (err) {
    // Lost a concurrent ownership race: another account claimed this Player, or
    // this account already owns a different Player (0025 unique index). Map the
    // known conflict to a stable 409 and finalize the intent; anything else is
    // re-thrown unchanged so it still surfaces as a 500.
    if (isClaimOwnershipConflict(err)) {
      updateIntent(id, { status: 'FAILED', error: 'account_already_linked' });
      throw new IntegrationError(
        'account_already_linked',
        409,
        'This Player is already linked to another account; manual resolution is required'
      );
    }
    throw err;
  }
  updateIntent(id, {
    status: 'CLAIMED',
    youtube_name: body.youtube_name ?? null,
    attestation_json: JSON.stringify({ ...att, attestation_signature: body.attestation_signature }),
  });

  return {
    status: 'CLAIMED',
    player_id: outcome.playerId,
    youtube_channel_id: body.youtube_channel_id,
    youtube_name: body.youtube_name ?? null,
  };
}
