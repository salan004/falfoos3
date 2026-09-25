/**
 * Phase 1 auth hardening — backend regression tests.
 *
 * Verifies that `GET /api/auth/me` is marked non-cacheable (`Cache-Control:
 * no-store`) and still answers the existing guest contract (`200 {user:null}`)
 * rather than an error status. Session/OAuth/cookie behavior is intentionally
 * untouched and therefore not re-tested here.
 *
 * Run: `ts-node src/routes/authRoutes.test.ts` (from `server/`).
 */

// Must be the first import: points DB_PATH at a throwaway temp file.
import { cleanupTestDb } from '../competitive/testDb';
import express from 'express';
import http from 'http';
import { authRoutes } from './authRoutes';
import { assertEqual, assertTrue, summarize, testAsync } from '../competitive/testHarness';

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use('/api/auth', authRoutes);
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
  await withServer(async (baseUrl) => {
    await testAsync('GET /api/auth/me returns 200 {user:null} when unauthenticated (not an error)', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assertEqual(res.status, 200, 'status');
      const body = (await res.json()) as { user: unknown };
      assertEqual(body.user, null, 'user');
    });

    await testAsync('GET /api/auth/me sets Cache-Control: no-store', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      const cacheControl = res.headers.get('cache-control');
      assertEqual(cacheControl, 'no-store', 'cache-control');
    });

    await testAsync('Cache-Control is present on the 200 response itself', async () => {
      const res = await fetch(`${baseUrl}/api/auth/me`);
      assertTrue(res.status === 200, 'status');
      assertEqual(res.headers.get('cache-control'), 'no-store', 'cache-control');
    });
  });

  cleanupTestDb();
  summarize('authRoutes');
}

void main();
