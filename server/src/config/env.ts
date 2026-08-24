/**
 * Phase 19 / Step 1 — centralized environment configuration layer.
 *
 * Single place that READS process.env once (dotenv is loaded first by
 * `import "dotenv/config"` in index.ts, which precedes this module in the
 * import graph) and exposes trimmed values plus a startup validation report
 * that prints variable NAMES/STATUSES only — never secret values.
 */

function trim(v: string | undefined): string | undefined {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
}

export const env = {
  NODE_ENV: trim(process.env.NODE_ENV),
  PORT: trim(process.env.PORT),
  DB_PATH: trim(process.env.DB_PATH),

  /** Break-glass admin socket token (Phase 9A). */
  ADMIN_TOKEN: trim(process.env.ADMIN_TOKEN),
  /** Comma-separated Google emails auto-granted role=admin (Phase 11F). */
  ADMIN_EMAILS: trim(process.env.ADMIN_EMAILS),

  GOOGLE_CLIENT_ID: trim(process.env.GOOGLE_CLIENT_ID),
  GOOGLE_CLIENT_SECRET: trim(process.env.GOOGLE_CLIENT_SECRET),
  GOOGLE_REDIRECT_URI: trim(process.env.GOOGLE_REDIRECT_URI),
  APP_BASE_URL: trim(process.env.APP_BASE_URL),

  YOUTUBE_API_KEY: trim(process.env.YOUTUBE_API_KEY),
  YOUTUBE_POLL_MS: trim(process.env.YOUTUBE_POLL_MS),
} as const;

export function isProduction(): boolean {
  return env.NODE_ENV === 'production';
}

/** Canonical public URLs (documentation/derivation only — never secrets). */
export const PRODUCTION_FRONTEND_URL = 'https://falfoos.vercel.app';
export const OAUTH_CALLBACK_PATH = '/api/auth/google/callback';

/** Redirect URI exactly as google.ts derives it (kept byte-compatible). */
export function deriveRedirectUri(): string | undefined {
  if (env.GOOGLE_REDIRECT_URI) return env.GOOGLE_REDIRECT_URI;
  const base = env.APP_BASE_URL?.replace(/\/+$/, '');
  if (base) return `${base}/api/auth/google/callback`;
  return undefined;
}

interface Row {
  name: string;
  status: 'SET' | 'MISSING';
}

function row(name: string, present: boolean): Row {
  return { name, status: present ? 'SET' : 'MISSING' };
}

/**
 * Startup configuration report. Logs NAMES and SET/MISSING statuses only —
 * never secret values. Warnings are loud in production, informational in dev;
 * this function NEVER throws so development boots stay frictionless.
 */
export function validateStartupConfig(): void {
  const prod = isProduction();
  const tag = prod ? 'PRODUCTION' : 'development';

  console.log(`[Config] Environment: ${env.NODE_ENV ?? '(not set)'} — running as ${tag}`);

  const rows: Row[] = [
    row('YOUTUBE_API_KEY', !!env.YOUTUBE_API_KEY),
    row('ADMIN_TOKEN', !!env.ADMIN_TOKEN),
    row('ADMIN_EMAILS', !!env.ADMIN_EMAILS),
    row('GOOGLE_CLIENT_ID', !!env.GOOGLE_CLIENT_ID),
    row('GOOGLE_CLIENT_SECRET', !!env.GOOGLE_CLIENT_SECRET),
    row('GOOGLE_REDIRECT_URI', !!env.GOOGLE_REDIRECT_URI),
    row('APP_BASE_URL', !!env.APP_BASE_URL),
    row('YOUTUBE_POLL_MS', !!env.YOUTUBE_POLL_MS),
    row('DB_PATH', !!env.DB_PATH),
    row('PORT', !!env.PORT),
  ];
  for (const r of rows) {
    console.log(`[Config] ${r.name.padEnd(20)} ${r.status}`);
  }

  // Core loop dependency — warn loudly everywhere, never crash.
  if (!env.YOUTUBE_API_KEY) {
    console.warn('[Config] ⚠ YOUTUBE_API_KEY is not set — YouTube chat connection will be unavailable.');
  }

  // Admin access paths (either one is sufficient).
  const adminViaToken = !!env.ADMIN_TOKEN;
  const adminViaEmails = !!env.ADMIN_EMAILS;
  if (!adminViaToken && !adminViaEmails) {
    const msg =
      'Admin access requires ADMIN_TOKEN (break-glass socket token) or ADMIN_EMAILS (Google bootstrap) — both are MISSING.';
    if (prod) console.error(`[Config] ❌ PRODUCTION: ${msg}`);
    else console.warn(`[Config] ⚠ ${msg} (fine for local dev)`);
  } else {
    console.log(
      `[Config] Admin path: ${adminViaToken && adminViaEmails ? 'ADMIN_TOKEN + ADMIN_EMAILS' : adminViaToken ? 'ADMIN_TOKEN' : 'ADMIN_EMAILS'}`
    );
  }

  // Google sign-in configuration.
  const redirect = deriveRedirectUri();
  const googleComplete = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && redirect);
  if (!googleComplete) {
    const msg = 'Google sign-in disabled until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a redirect URI are set.';
    if (prod) console.error(`[Config] ❌ PRODUCTION: ${msg}`);
    else console.warn(`[Config] ℹ ${msg}`);
  } else if (redirect) {
    console.log(`[Config] OAuth callback: ${redirect}`);
  }

  // Canonical production URLs — surfaced so misconfiguration is obvious.
  if (prod) {
    console.log(`[Config] Production frontend (canonical): ${PRODUCTION_FRONTEND_URL}`);
    if (redirect && !redirect.startsWith('https://')) {
      console.error('[Config] ❌ PRODUCTION: OAuth redirect URI must be HTTPS.');
    }
  }
}
