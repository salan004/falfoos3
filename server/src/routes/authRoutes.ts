import { Router } from 'express';
import {
  buildAuthorizeUrl,
  exchangeCodeForProfile,
  getGoogleConfig,
} from '../auth/google';
import {
  clearOAuthFlowCookies,
  createSession,
  readOAuthFlow,
  resolveSession,
  revokeCurrentSession,
  setOAuthFlowCookies,
  upsertGoogleUser,
} from '../auth/session';
import { checkClaim, startClaim } from '../auth/claiming';
import { getDb } from '../db/db';

/**
 * Phase 11C — authentication routes. Fully additive: no existing route or
 * socket behavior depends on these, and nothing here is required for guests.
 */
export const authRoutes = Router();

/** Begins the Google OAuth flow (state + PKCE cookies set server-side). */
authRoutes.get('/google', (req, res) => {
  const cfg = getGoogleConfig();
  if (!cfg) {
    res.status(503).send('Google sign-in is not configured on this server.');
    return;
  }
  const flow = buildAuthorizeUrl(cfg);
  setOAuthFlowCookies(res, flow.state, flow.codeVerifier);
  res.redirect(flow.url);
});

/**
 * OAuth callback: validates state cookie + PKCE verifier, exchanges the
 * single-use code, upserts the user, issues a fresh session cookie, then
 * redirects to a clean RELATIVE url (open-redirect safe).
 */
authRoutes.get('/google/callback', async (req, res) => {
  const cfg = getGoogleConfig();
  if (!cfg) {
    res.status(503).redirect('/?authError=unconfigured');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const flow = readOAuthFlow(req);
  clearOAuthFlowCookies(res);

  if (!code || !state || !flow.state || !flow.codeVerifier || state !== flow.state) {
    console.warn('[Falfoos] OAuth callback rejected: state/code mismatch');
    res.status(400).redirect('/?authError=state');
    return;
  }

  try {
    const profile = await exchangeCodeForProfile(cfg, code, flow.codeVerifier);
    const user = upsertGoogleUser(profile);
    // Fresh session id at every login — fixation-proof.
    createSession(res, user.id);
    console.log(`[Falfoos] User signed in via Google: ${user.id}`);
    res.redirect('/');
  } catch (err) {
    console.error(
      '[Falfoos] OAuth callback failed:',
      err instanceof Error ? err.message : String(err)
    );
    res.status(502).redirect('/?authError=exchange');
  }
});

/** Current session lookup. Returns {user:null} rather than an error when guest. */
authRoutes.get('/me', (req, res) => {
  const user = resolveSession(req);
  // Phase 11D — additive flag: has this user claimed any guest identity?
  let guestLinked = false;
  if (user) {
    guestLinked = !!getDb()
      .prepare('SELECT 1 FROM guests WHERE claimed_user_id = ? LIMIT 1')
      .get(user.id);
  }
  res.json({ user, guestLinked });
});

/** Logout: revokes the session row and clears the cookie. Idempotent. */
authRoutes.post('/logout', (req, res) => {
  revokeCurrentSession(req, res);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Phase 11D — guest claiming (Tier 2: live-chat challenge). Requires a
// session; guests never touch these endpoints.
// ---------------------------------------------------------------------------

/** Issues a short single-use challenge code to post in the live chat. */
authRoutes.post('/claim/start', (req, res) => {
  const user = resolveSession(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  try {
    const { code, expiresAt } = startClaim(user);
    res.json({ code, expiresAt });
  } catch (err) {
    if (err instanceof Error && err.message === 'rateLimited') {
      res.status(429).json({ error: 'rateLimited' });
      return;
    }
    throw err;
  }
});

/**
 * Checks the live chat for the posted code and performs the transactional
 * claim. Error codes map 1:1 to the claiming module's failure modes.
 */
authRoutes.post('/claim/check', async (req, res) => {
  const user = resolveSession(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  try {
    const outcome = await checkClaim(user, req.body?.code);
    res.json(outcome);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown';
    const statusMap: Record<string, number> = {
      notConnected: 409,
      invalidCode: 400,
      noChallenge: 400,
      expired: 410,
      noAttempts: 429,
      codeNotFound: 404,
      claimedByOther: 409,
      rateLimited: 429,
    };
    res.status(statusMap[reason] ?? 500).json({ error: reason });
  }
});
