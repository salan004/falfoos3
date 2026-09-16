import { env } from '../config/env';

/**
 * Optional enrichment for tournament Guests.
 *
 * Resolves a YouTube channel's public thumbnail URL via the YouTube Data API so
 * a newly auto-created Guest can carry `guests.avatar_url`. This is BEST-EFFORT:
 * every failure mode (missing key, HTTP error, timeout, malformed JSON, missing
 * fields, invalid URL) resolves to `null` and never throws, so ticket-purchase
 * processing and participant registration are never blocked.
 *
 * `YOUTUBE_API_KEY` is read server-side only and is never returned, logged, or
 * exposed to clients.
 */

const CHANNELS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
const FETCH_TIMEOUT_MS = 4000;

/** Best-first thumbnail preference; unknown keys fall back to any valid URL. */
const THUMBNAIL_PREFERENCE = ['maxres', 'standard', 'high', 'medium', 'default'] as const;

export interface FetchChannelAvatarDeps {
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable override; defaults to `env.YOUTUBE_API_KEY`. */
  apiKey?: string;
}

/** True only for absolute http(s) URLs (rejects javascript:, data:, relative). */
function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Picks the best available http(s) thumbnail URL from a `snippet.thumbnails` map. */
function pickThumbnail(thumbnails: unknown): string | null {
  if (typeof thumbnails !== 'object' || thumbnails === null) return null;
  const record = thumbnails as Record<string, unknown>;

  for (const key of THUMBNAIL_PREFERENCE) {
    const entry = record[key];
    if (typeof entry === 'object' && entry !== null) {
      const url = (entry as Record<string, unknown>).url;
      if (isHttpUrl(url)) return url;
    }
  }

  // Any other valid thumbnail key (future/unknown sizes).
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      const url = (value as Record<string, unknown>).url;
      if (isHttpUrl(url)) return url;
    }
  }
  return null;
}

/**
 * Fetches the channel thumbnail URL, or null when unavailable. Never throws.
 */
export async function fetchYouTubeChannelAvatarUrl(
  channelId: string,
  deps: FetchChannelAvatarDeps = {}
): Promise<string | null> {
  const apiKey = deps.apiKey ?? env.YOUTUBE_API_KEY;
  if (!apiKey || typeof channelId !== 'string' || channelId.trim().length === 0) {
    return null;
  }
  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    const url =
      `${CHANNELS_ENDPOINT}?part=snippet&id=${encodeURIComponent(channelId)}` +
      `&key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;

    const data = (await res.json()) as {
      items?: Array<{ snippet?: { thumbnails?: unknown } }>;
    };
    const snippet = data?.items?.[0]?.snippet;
    if (!snippet) return null;
    return pickThumbnail(snippet.thumbnails);
  } catch {
    // Network error, timeout, malformed JSON, unexpected shape — enrichment only.
    return null;
  }
}
