import { Router, type Request, type Response } from 'express';
import { resolveSession, type SessionUser } from '../auth/session';
import { requireAdmin } from '../middleware/requireAdmin';
import { findLinkedPlayerForUser } from '../identity/identityService';
import { IntegrationError, isIntegrationError } from './errors';
import { BotIntegrationError } from './falfoosBotClient';
import { startLink, verifyLink, normalizeLinkOperation } from './linkService';
import { getPurchaseStatus, recoverPurchaseIntents, startPurchase } from './purchaseService';

/**
 * Phase 7 — authenticated website endpoints that drive account linking and
 * tournament ticket purchase through the bot integration layer.
 *
 * Auth: the website session cookie (`resolveSession`). The client never sends
 * (and is never trusted for) `website_user_id`, `player_id`, `claimed_user_id`,
 * price, amount, balance or discord id. Responses are shaped from server state.
 */

export const websiteIntegrationRoutes = Router();

function requireUser(req: Request, res: Response): SessionUser | null {
  const user = resolveSession(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return null;
  }
  return user;
}

function sendError(res: Response, err: unknown): void {
  if (isIntegrationError(err)) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof BotIntegrationError) {
    res.status(err.httpStatus).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[websiteIntegration] Unexpected error:', err);
  res.status(500).json({ error: 'internal_error', message: 'Internal server error' });
}

/** Account status for the linking UI: has this account linked a Player? */
websiteIntegrationRoutes.get('/account', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const row = findLinkedPlayerForUser(user.id);
  res.json({
    linked: Boolean(row),
    player: row
      ? { player_id: row.player_id, youtube_channel_id: row.youtube_channel_id, display_name: row.display_name }
      : null,
  });
});

/** Begins linking for the authenticated account (server-owned request_id). */
websiteIntegrationRoutes.post('/link/start', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await startLink(user, req.body?.channel, normalizeLinkOperation(req.body?.operation));
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/** Verifies the channel challenge and claims the EXISTING Player atomically. */
websiteIntegrationRoutes.post('/link/verify', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await verifyLink(user, req.body?.request_id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/** Starts (or resumes) a website tournament ticket purchase. */
websiteIntegrationRoutes.post('/purchase', async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const result = await startPurchase(user, req.body?.tournament_id, req.body?.game_id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/** Polls a durable purchase intent (safe across refresh/retry). */
websiteIntegrationRoutes.post('/purchase/status', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    res.json(getPurchaseStatus(user, req.body?.request_id));
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Manual recovery trigger (idempotent; also runs at startup). Global across all
 * users, so it reuses the existing admin authorization (`requireAdmin`): 401
 * when unauthenticated, 403 for non-admins.
 */
websiteIntegrationRoutes.post('/recover', requireAdmin, async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const summary = await recoverPurchaseIntents();
    res.json(summary);
  } catch (err) {
    sendError(res, err);
  }
});

export { IntegrationError };
