/**
 * YouTubeChannelAvatar — channel thumbnail enrichment tests.
 *
 * All HTTP is mocked; no real YouTube API calls are made and no DB is touched.
 * Run: `ts-node src/games/YouTubeChannelAvatar.test.ts` (wired into `npm run test`).
 */

import { fetchYouTubeChannelAvatarUrl } from './YouTubeChannelAvatar';
import { assertEqual, assertNull, assertTrue, summarize, testAsync } from '../competitive/testHarness';

interface FetchCallLog {
  count: number;
  lastUrl?: string;
}

function mockFetch(
  response: { ok?: boolean; json?: () => Promise<unknown>; throws?: Error },
  log: FetchCallLog
): typeof fetch {
  return (async (url: unknown) => {
    log.count += 1;
    log.lastUrl = String(url);
    if (response.throws) throw response.throws;
    return {
      ok: response.ok ?? true,
      status: response.ok === false ? 500 : 200,
      json: response.json ?? (async () => ({})),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function channelBody(thumbnails: unknown): unknown {
  return { items: [{ snippet: { thumbnails } }] };
}

async function main(): Promise<void> {
  await testAsync('returns the high thumbnail URL and calls the channels endpoint once', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_abc', {
      apiKey: 'server-key',
      fetchImpl: mockFetch(
        { json: async () => channelBody({ default: { url: 'https://yt.example/d.jpg' }, high: { url: 'https://yt.example/h.jpg' } }) },
        log
      ),
    });
    assertEqual(url, 'https://yt.example/h.jpg', 'high thumbnail chosen');
    assertEqual(log.count, 1, 'one fetch');
    assertTrue((log.lastUrl ?? '').includes('googleapis.com/youtube/v3/channels'), 'channels endpoint used');
    assertTrue((log.lastUrl ?? '').includes('UC_abc'), 'channel id sent');
  });

  await testAsync('prefers maxres/standard over high when present', async () => {
    const log: FetchCallLog = { count: 0 };
    const maxres = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody({ high: { url: 'https://yt.example/h.jpg' }, maxres: { url: 'https://yt.example/max.jpg' } }) }, log),
    });
    assertEqual(maxres, 'https://yt.example/max.jpg', 'maxres preferred');
  });

  await testAsync('falls back to default when high/medium are absent', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody({ default: { url: 'https://yt.example/d.jpg' } }) }, log),
    });
    assertEqual(url, 'https://yt.example/d.jpg', 'default used');
  });

  await testAsync('falls back to an unknown thumbnail key with a valid URL', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody({ custom: { url: 'https://yt.example/c.jpg' } }) }, log),
    });
    assertEqual(url, 'https://yt.example/c.jpg', 'unknown key used');
  });

  await testAsync('missing YOUTUBE_API_KEY returns null without any fetch', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: '',
      fetchImpl: mockFetch({ json: async () => channelBody({ high: { url: 'https://yt.example/h.jpg' } }) }, log),
    });
    assertNull(url, 'null without key');
    assertEqual(log.count, 0, 'no fetch performed');
  });

  await testAsync('empty channel id returns null without any fetch', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('   ', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody({}) }, log),
    });
    assertNull(url, 'null for empty channel id');
    assertEqual(log.count, 0, 'no fetch performed');
  });

  await testAsync('non-OK HTTP response returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ ok: false, json: async () => ({}) }, log),
    });
    assertNull(url, 'null on HTTP error');
  });

  await testAsync('malformed JSON returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => { throw new Error('bad json'); } }, log),
    });
    assertNull(url, 'null on malformed JSON');
  });

  await testAsync('missing items returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => ({ items: [] }) }, log),
    });
    assertNull(url, 'null when no items');
  });

  await testAsync('missing snippet returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => ({ items: [{}] }) }, log),
    });
    assertNull(url, 'null when no snippet');
  });

  await testAsync('missing thumbnails returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody(undefined) }, log),
    });
    assertNull(url, 'null when no thumbnails');
  });

  await testAsync('invalid thumbnail URL (javascript:) returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ json: async () => channelBody({ high: { url: 'javascript:alert(1)' }, default: { url: 'data:text/html,x' } }) }, log),
    });
    assertNull(url, 'null for unsafe URL');
  });

  await testAsync('network error / timeout returns null', async () => {
    const log: FetchCallLog = { count: 0 };
    const url = await fetchYouTubeChannelAvatarUrl('UC_a', {
      apiKey: 'k',
      fetchImpl: mockFetch({ throws: new Error('timeout') }, log),
    });
    assertNull(url, 'null on thrown fetch');
  });

  summarize('YouTubeChannelAvatar');
}

main().catch((err) => {
  console.error('YouTubeChannelAvatar test suite crashed:', err);
  process.exit(1);
});
