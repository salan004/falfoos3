import crypto from 'crypto';
import { getDb } from '../db/db';
import type { YouTubeChatService } from '../core/YouTubeChatService';
import type { SessionUser } from './session';

/**
 * Phase 11D — Tier-2 guest claiming via a live-chat challenge.
 *
 * Flow: an authenticated user requests a short single-use code and posts it
 * as a normal chat message from THEIR OWN YouTube channel. The server scans
 * fresh live-chat messages for that exact code, learns the channelId, then
 * links/claims the guest row inside one transaction.
 *
 * Safety rules enforced here:
 * - knowing a guest UUID never grants a claim (proof = posting the code)
 * - claims are guarded by `claimed_user_id IS NULL` → double-claim races
 *   lose (0 changes) and surface as a conflict
 * - no rows are ever rewritten destructively; history stays auditable
 */

// ---------------------------------------------------------------------------
// Live challenge codes — deliberately in-memory only: they are ephemeral
// credentials with a 10-minute TTL; surviving a restart is not desired.
// ---------------------------------------------------------------------------

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const CODE_LENGTH = 8;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_STARTS_PER_WINDOW = 3;
const START_WINDOW_MS = 60 * 60 * 1000;
const MAX_CHECK_ATTEMPTS = 10;

interface ActiveChallenge {
  code: string;
  createdAt: number;
  expiresAt: number;
  attemptsLeft: number;
}

const activeChallenges = new Map<string, ActiveChallenge>(); // userId -> challenge
const startTimestamps = new Map<string, number[]>(); // userId -> start times

/** Bound to the CURRENT live connection by index.ts (null when offline). */
let currentChatService: YouTubeChatService | null = null;

export function setCurrentChatService(service: YouTubeChatService | null): void {
  currentChatService = service;
}

function pruneRateWindow(userId: string): number[] {
  const now = Date.now();
  const stamps = (startTimestamps.get(userId) ?? []).filter((t) => now - t < START_WINDOW_MS);
  startTimestamps.set(userId, stamps);
  return stamps;
}

function generateCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export function normalizeClaimCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  return cleaned.length === CODE_LENGTH ? cleaned : null;
}

export interface ClaimStartResult {
  code: string;
  expiresAt: number;
}

/** Issues the caller's challenge code (replacing any previous one). */
export function startClaim(user: SessionUser): ClaimStartResult {
  const stamps = pruneRateWindow(user.id);
  if (stamps.length >= MAX_STARTS_PER_WINDOW) {
    throw new Error('rateLimited');
  }
  stamps.push(Date.now());

  const now = Date.now();
  const challenge: ActiveChallenge = {
    code: generateCode(),
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
    attemptsLeft: MAX_CHECK_ATTEMPTS,
  };
  activeChallenges.set(user.id, challenge);
  console.log(`[Falfoos] Claim challenge started for user ${user.id} (expires in 10m)`);
  return { code: challenge.code, expiresAt: challenge.expiresAt };
}

function clearChallenge(userId: string): void {
  activeChallenges.delete(userId);
}

export interface ClaimCheckOutcome {
  status: 'claimed' | 'alreadyClaimed';
  playerId: string;
}

/**
 * Verifies the posted code against the live chat and performs the claim.
 * Throws Error('notConnected' | 'noChallenge' | 'expired' | 'noAttempts' |
 * 'codeNotFound' | 'claimedByOther') so routes can map them cleanly.
 */
export async function checkClaim(user: SessionUser, rawCode: unknown): Promise<ClaimCheckOutcome> {
  if (!currentChatService || !currentChatService.isConnected()) {
    throw new Error('notConnected');
  }

  const code = normalizeClaimCode(rawCode);
  if (!code) throw new Error('invalidCode');

  const challenge = activeChallenges.get(user.id);
  if (!challenge) throw new Error('noChallenge');
  if (Date.now() > challenge.expiresAt) {
    clearChallenge(user.id);
    throw new Error('expired');
  }

  const found = await currentChatService.verifyChallengeCode(code).catch(() => null);

  // Exactly ONE attempt is consumed per check — brute-forcing is capped.
  challenge.attemptsLeft -= 1;
  if (!found) {
    if (challenge.attemptsLeft <= 0) {
      clearChallenge(user.id);
      throw new Error('noAttempts');
    }
    throw new Error('codeNotFound');
  }

  clearChallenge(user.id);
  return claimGuestForUser(user, found.channelId, found.displayName, found.avatarUrl);
}

/**
 * Transactional link: upsert the guest row for the proven channel, bind the
 * channelId, then set claimed_user_id — but ONLY while it is still NULL.
 */
export function claimGuestForUser(
  user: SessionUser,
  channelId: string,
  displayName: string,
  avatarUrl?: string
): ClaimCheckOutcome {
  const db = getDb();
  const now = Date.now();

  const outcome = db.transaction((): ClaimCheckOutcome => {
    // Legacy rows are keyed BY their channelId; newer rows carry it in the
    // dedicated column. Either shape may already exist.
    let row = db
      .prepare('SELECT player_id, claimed_user_id FROM guests WHERE youtube_channel_id = ? OR player_id = ?')
      .get(channelId, channelId) as { player_id: string; claimed_user_id: string | null } | undefined;

    let playerId: string;
    if (!row) {
      playerId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO guests (player_id, display_name, avatar_url, first_seen, last_seen, claimed_user_id, youtube_channel_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      ).run(playerId, displayName, avatarUrl ?? null, now, now, channelId);
    } else {
      playerId = row.player_id;
      db.prepare('UPDATE guests SET last_seen = ?, display_name = ?, avatar_url = COALESCE(?, avatar_url) WHERE player_id = ?')
        .run(now, displayName, avatarUrl ?? null, playerId);
      // Idempotent backfill of the dedicated column on legacy rows.
      db.prepare('UPDATE guests SET youtube_channel_id = ? WHERE player_id = ? AND youtube_channel_id IS NULL')
        .run(channelId, playerId);
    }

    const result = db
      .prepare('UPDATE guests SET claimed_user_id = ? WHERE player_id = ? AND claimed_user_id IS NULL')
      .run(user.id, playerId);

    if (result.changes === 0) {
      const owner = db.prepare('SELECT claimed_user_id FROM guests WHERE player_id = ?').get(playerId) as
        | { claimed_user_id: string }
        | undefined;
      if (owner?.claimed_user_id === user.id) {
        return { status: 'alreadyClaimed', playerId };
      }
      throw new Error('claimedByOther');
    }

    console.log(`[Falfoos] Guest ${playerId} claimed by user ${user.id} (channel proof ok)`);
    return { status: 'claimed', playerId };
  })();

  return outcome;
}
