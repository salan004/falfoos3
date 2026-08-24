import { ChatMessage } from './BaseGame';

export type ChatCallback = (msg: ChatMessage) => void;
/**
 * Called for every failed poll cycle. `consecutiveFailures` lets the caller
 * decide when the connection should be considered lost.
 */
export type ErrorCallback = (error: Error, consecutiveFailures: number) => void;

/** Hard cap per YouTube API request so a hung connection surfaces as a poll error instead of stalling forever. */
const YOUTUBE_FETCH_TIMEOUT_MS = 10000;

/** Phase 14 — connection health snapshot for admin-facing telemetry. */
export interface YouTubeHealthSnapshot {
  pollsOk: number;
  pollsFailed: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMessage: string | null;
  consecutiveFailures: number;
  /** Sticky until the next successful connect — polling cannot succeed while true. */
  quotaExceeded: boolean;
}

export function isQuotaErrorMessage(message: string): boolean {
  return message.includes('quotaExceeded') || message.includes('dailyLimitExceeded');
}

/** Surfaces YouTube API errors (incl. the quota reason) as tagged Error messages. */
function throwOnApiError(res: Response, data: any): void {
  if (res.ok) return;
  const reason: string = data?.error?.errors?.[0]?.reason ?? 'httpError';
  const apiMessage: string = data?.error?.message ?? String(res.status);
  throw new Error(`yt:${reason}:${apiMessage}`);
}

export class YouTubeChatService {
  private videoId: string | null = null;
  private apiKey: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private nextPageToken: string | null = null;
  private consecutiveFailures = 0;
  private onMessage: ChatCallback;
  private onError: ErrorCallback | null;
  private pollMs: number;

  // Phase 14 telemetry
  private pollsOk = 0;
  private pollsFailed = 0;
  private lastSuccessAt: number | null = null;
  private lastErrorAt: number | null = null;
  private lastErrorMessage: string | null = null;
  private quotaExceeded = false;

  constructor(onMessage: ChatCallback, pollMs = 5000, onError?: ErrorCallback) {
    this.onMessage = onMessage;
    this.pollMs = pollMs;
    this.onError = onError ?? null;
  }

  isConnected(): boolean {
    return this.videoId !== null;
  }

  getVideoId(): string | null {
    return this.videoId;
  }

  /** Phase 14 — read-only telemetry snapshot for status broadcasts. */
  getHealth(): YouTubeHealthSnapshot {
    return {
      pollsOk: this.pollsOk,
      pollsFailed: this.pollsFailed,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      consecutiveFailures: this.consecutiveFailures,
      quotaExceeded: this.quotaExceeded,
    };
  }

  /**
   * Connects to the live chat of a video. Verifies that an active live chat
   * actually exists BEFORE reporting success; throws otherwise so the caller
   * can broadcast a real failure status instead of a fake "connected".
   */
  async connect(videoId: string, apiKey: string): Promise<void> {
    this.videoId = videoId;
    this.apiKey = apiKey;
    this.nextPageToken = null;
    this.consecutiveFailures = 0;

    // A fresh connect clears the sticky quota flag — the owner explicitly
    // asked to try again (e.g. quota renewed).
    this.quotaExceeded = false;

    let liveChatId: string | null;
    try {
      liveChatId = await this.getLiveChatId();
    } catch (err) {
      this.resetConnection();
      throw err instanceof Error ? err : new Error('Failed to reach the YouTube API');
    }

    if (!liveChatId) {
      this.resetConnection();
      throw new Error('No active live chat found for this video');
    }

    this.startPolling();
    console.log(`[YouTubeChat] Connected to live chat for video: ${videoId}`);
  }

  disconnect(): void {
    this.stopPolling();
    this.resetConnection();
    console.log('[YouTubeChat] Disconnected');
  }

  private resetConnection(): void {
    this.videoId = null;
    this.apiKey = null;
    this.nextPageToken = null;
    this.consecutiveFailures = 0;
  }

  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private startPolling(): void {
    this.poll();
    this.pollingInterval = setInterval(() => this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (!this.videoId || !this.apiKey) return;

    try {
      const liveChatId = await this.getLiveChatId();
      if (!liveChatId) return;

      const messages = await this.fetchMessages(liveChatId);
      this.consecutiveFailures = 0;
      this.pollsOk++;
      this.lastSuccessAt = Date.now();
      for (const msg of messages) {
        this.onMessage(msg);
      }
    } catch (err) {
      this.consecutiveFailures++;
      this.pollsFailed++;
      const error = err instanceof Error ? err : new Error(String(err));
      if (isQuotaErrorMessage(error.message)) {
        // Sticky: further polls are pointless until the daily quota renews.
        this.quotaExceeded = true;
      }
      this.lastErrorAt = Date.now();
      this.lastErrorMessage = error.message;
      console.error(
        `[YouTubeChat] Poll error (${this.consecutiveFailures} consecutive):`,
        error.message
      );
      this.onError?.(error, this.consecutiveFailures);
    }
  }

  private async getLiveChatId(): Promise<string | null> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${this.videoId}&key=${this.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS) });
    const data: any = await res.json();
    throwOnApiError(res, data);
    return data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  }

  /**
   * Cursor-SAFE page fetch: unlike fetchMessages() this never touches
   * nextPageToken, so claim verification cannot disturb live polling.
   */
  private async fetchMessagesPage(
    liveChatId: string,
    pageToken?: string | null
  ): Promise<{ messages: ChatMessage[]; nextToken: string | null }> {
    let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${this.apiKey}`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    const res = await fetch(url, { signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS) });
    const data: any = await res.json();
    throwOnApiError(res, data);

    const messages = (data?.items ?? []).map((item: Record<string, any>) => ({
      author: item.authorDetails.displayName,
      authorId: item.authorDetails.channelId,
      authorImageUrl: item.authorDetails.profileImageUrl ?? undefined,
      message: item.snippet.displayMessage,
      timestamp: new Date(item.snippet.publishedAt).getTime(),
      isModerator: item.authorDetails.isChatModerator,
    }));
    return { messages, nextToken: data?.nextPageToken ?? null };
  }

  private async fetchMessages(liveChatId: string): Promise<ChatMessage[]> {
    const { messages, nextToken } = await this.fetchMessagesPage(liveChatId, this.nextPageToken);
    this.nextPageToken = nextToken;
    return messages;
  }

  /**
   * Phase 11D — Tier-2 claim verification. Scans the LATEST live-chat page for
   * an exact (case-insensitive) match of the challenge code posted within the
   * last 10 minutes. Returns the posting channel's identity, or null.
   */
  async verifyChallengeCode(
    normalizedCode: string
  ): Promise<{ channelId: string; displayName: string; avatarUrl?: string } | null> {
    if (!this.videoId || !this.apiKey) return null;

    const liveChatId = await this.getLiveChatId();
    if (!liveChatId) return null;

    // Fresh page only (no token) — recent messages are what matters here.
    const { messages } = await this.fetchMessagesPage(liveChatId);
    const cutoff = Date.now() - 10 * 60 * 1000;

    for (const msg of messages) {
      if (msg.timestamp < cutoff) continue;
      const candidate = msg.message.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
      if (candidate === normalizedCode && msg.authorId) {
        return {
          channelId: msg.authorId,
          displayName: msg.author,
          avatarUrl: msg.authorImageUrl,
        };
      }
    }
    return null;
  }
}
