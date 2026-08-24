import crypto from 'crypto';

/**
 * Phase 11C — hand-rolled Google OAuth 2.0 Authorization Code flow with PKCE.
 * Zero dependencies: Node crypto + global fetch only.
 *
 * Security contract:
 * - client secret lives ONLY in server env, never logged, never sent to clients
 * - PKCE S256 binds the authorization code to this server's verifier
 * - userinfo is fetched server-side; tokens are used once and discarded
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/** Login scopes ONLY — no YouTube scopes here (channel claiming is Phase 11D). */
const LOGIN_SCOPES = 'openid email profile';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function getGoogleConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  let redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!redirectUri) {
    const base = process.env.APP_BASE_URL?.trim().replace(/\/+$/, '');
    if (base) redirectUri = `${base}/api/auth/google/callback`;
  }
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export interface OAuthFlow {
  url: string;
  state: string;
  codeVerifier: string;
}

export function buildAuthorizeUrl(cfg: GoogleOAuthConfig): OAuthFlow {
  const state = crypto.randomBytes(32).toString('hex');
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: LOGIN_SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return { url: `${AUTH_URL}?${params.toString()}`, state, codeVerifier };
}

export interface GoogleProfile {
  /** Stable Google account id — becomes auth_identities.provider_uid. */
  sub: string;
  name?: string;
  picture?: string;
  /**
   * Phase 11F — captured (never stored or logged) so ADMIN_EMAILS bootstrap
   * can match the verified account email. The `email` scope is already granted.
   */
  email?: string;
}

export async function exchangeCodeForProfile(
  cfg: GoogleOAuthConfig,
  code: string,
  codeVerifier: string
): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code',
    redirect_uri: cfg.redirectUri,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new Error('token exchange returned no access_token');

  const uiRes = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!uiRes.ok) throw new Error(`userinfo failed (${uiRes.status})`);
  const info = (await uiRes.json()) as {
    sub?: string;
    name?: string;
    picture?: string;
    email?: string;
  };
  if (!info.sub) throw new Error('userinfo missing sub');

  return { sub: info.sub, name: info.name, picture: info.picture, email: info.email };
}
