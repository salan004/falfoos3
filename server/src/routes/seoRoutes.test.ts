/**
 * SEO Fix 1 — API-origin robots + sitemap regression tests.
 *
 * Verifies /robots.txt is a real robots file (never the SPA shell), /sitemap.xml
 * is valid XML with canonical website URLs, and the sitemap includes public
 * games/tournaments/claimed players while excluding private or hash URLs.
 *
 * Run: `ts-node src/routes/seoRoutes.test.ts` (from `server/`).
 */

import { cleanupTestDb } from '../competitive/testDb';
import {
  seedGame,
  seedPlayer,
  seedTournament,
  seedUser,
} from '../competitive/competitiveTestSeed';
import { getDb } from '../db/db';
import express from 'express';
import http from 'http';
import { seoRoutes } from './seoRoutes';
import { assertEqual, assertTrue, summarize, testAsync } from '../competitive/testHarness';

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(seoRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main(): Promise<void> {
  seedGame('seo-game-1', 'seo-slug-1');
  seedUser('seo-admin');
  seedTournament({ id: 'seo-tour-1', gameId: 'seo-game-1', createdBy: 'seo-admin', status: 'open' });
  seedTournament({ id: 'seo-tour-draft', gameId: 'seo-game-1', createdBy: 'seo-admin', status: 'draft' });
  seedPlayer('seo-player-claimed');
  seedUser('seo-user-claimed');
  getDb()
    .prepare('UPDATE guests SET claimed_user_id = ? WHERE player_id = ?')
    .run('seo-user-claimed', 'seo-player-claimed');
  seedPlayer('seo-player-unclaimed');

  await withServer(async (baseUrl) => {
    await testAsync('robots.txt disallows the API origin but allows uploads', async () => {
      const res = await fetch(`${baseUrl}/robots.txt`);
      assertEqual(res.status, 200, 'status');
      assertTrue((res.headers.get('content-type') ?? '').includes('text/plain'), 'content-type');
      const body = await res.text();
      assertTrue(body.includes('Disallow: /'), 'disallows the origin');
      assertTrue(body.includes('Allow: /api/uploads/'), 'allows uploads');
    });

    await testAsync('robots.txt never returns the SPA shell', async () => {
      const body = await (await fetch(`${baseUrl}/robots.txt`)).text();
      assertTrue(!body.includes('<!DOCTYPE html>'), 'no HTML shell');
    });

    await testAsync('sitemap.xml is valid XML with canonical website URLs', async () => {
      const res = await fetch(`${baseUrl}/sitemap.xml`);
      assertEqual(res.status, 200, 'status');
      assertTrue((res.headers.get('content-type') ?? '').includes('xml'), 'content-type');
      const body = await res.text();
      assertTrue(body.startsWith('<?xml'), 'xml declaration');
      assertTrue(body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'), 'urlset');
      assertTrue(body.includes('<loc>https://falfoos.com/</loc>'), 'homepage');
      assertTrue(body.includes('<loc>https://falfoos.com/games</loc>'), 'games page');
    });

    await testAsync('sitemap includes active games, open tournaments and claimed players', async () => {
      const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
      assertTrue(body.includes('/stream-games/seo-game-1'), 'active game');
      assertTrue(body.includes('/tournaments/seo-tour-1'), 'open tournament');
      assertTrue(body.includes('/player/seo-player-claimed'), 'claimed player');
    });

    await testAsync('sitemap excludes draft tournaments, unclaimed guests and hash URLs', async () => {
      const body = await (await fetch(`${baseUrl}/sitemap.xml`)).text();
      assertTrue(!body.includes('seo-tour-draft'), 'draft excluded');
      assertTrue(!body.includes('seo-player-unclaimed'), 'unclaimed excluded');
      assertTrue(!body.includes('#/'), 'no hash URLs');
      assertTrue(!body.includes('/dashboard'), 'no admin URLs');
      assertTrue(!body.includes('/api/'), 'no API URLs');
    });
  });

  cleanupTestDb();
  summarize('seoRoutes');
}

void main();
