import { ChatMessage } from './BaseGame';

export type ChatCallback = (msg: ChatMessage) => void;

export class YouTubeChatService {
  private videoId: string | null = null;
  private apiKey: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private nextPageToken: string | null = null;
  private onMessage: ChatCallback;
  private pollMs: number;

  constructor(onMessage: ChatCallback, pollMs = 5000) {
    this.onMessage = onMessage;
    this.pollMs = pollMs;
  }

  connect(videoId: string, apiKey: string): void {
    this.videoId = videoId;
    this.apiKey = apiKey;
    this.nextPageToken = null;
    this.startPolling();
    console.log(`[YouTubeChat] Connected to live chat for video: ${videoId}`);
  }

  disconnect(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.videoId = null;
    this.apiKey = null;
    console.log('[YouTubeChat] Disconnected');
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
      for (const msg of messages) {
        this.onMessage(msg);
      }
    } catch (err) {
      console.error('[YouTubeChat] Poll error:', err);
    }
  }

  private async getLiveChatId(): Promise<string | null> {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${this.videoId}&key=${this.apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    return data?.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  }

  private async fetchMessages(liveChatId: string): Promise<ChatMessage[]> {
    let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${this.apiKey}`;
    if (this.nextPageToken) {
      url += `&pageToken=${this.nextPageToken}`;
    }

    const res = await fetch(url);
    const data: any = await res.json();

    this.nextPageToken = data?.nextPageToken ?? null;

    return (data?.items ?? []).map((item: Record<string, any>) => ({
      author: item.authorDetails.displayName,
      authorId: item.authorDetails.channelId,
      message: item.snippet.displayMessage,
      timestamp: new Date(item.snippet.publishedAt).getTime(),
      isModerator: item.authorDetails.isChatModerator,
    }));
  }
}
