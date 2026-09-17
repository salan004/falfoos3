/**
 * Phase 4D — API test harness.
 *
 * Spins up a real Express app with the Phase 4D routers on an ephemeral port so
 * tests exercise real routing, `express.json()`, `requireAdmin` session checks
 * and the service/database stack. Import AFTER `./testDb`.
 */

import express from 'express';
import http from 'http';
import { tournamentCompetitiveRoutes } from '../routes/tournamentCompetitiveRoutes';
import { gamesRoutes } from '../routes/gamesRoutes';
import { adminTournamentsRoutes } from '../routes/adminTournamentsRoutes';
import { adminTournamentCompetitiveRoutes } from '../routes/adminTournamentCompetitiveRoutes';

export interface TestApi {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startTestApi(): Promise<TestApi> {
  const app = express();
  app.use(express.json());
  // Production mount order: competitive routes first, then the games catalog
  // (which must scope its game routes under `/games` so it never shadows
  // `/api/tournaments` and friends).
  app.use('/api', tournamentCompetitiveRoutes);
  app.use('/api', gamesRoutes);
  // Production mount order (index.ts): generic admin router first, then the
  // competitive admin sub-paths.
  app.use('/api/admin/tournaments', adminTournamentsRoutes);
  app.use('/api/admin/tournaments', adminTournamentCompetitiveRoutes);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

export function cookieFor(sessionId: string): string {
  return `falfoos_session=${sessionId}`;
}

export async function request<T = unknown>(
  baseUrl: string,
  path: string,
  init?: { method?: string; body?: unknown; cookie?: string }
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init?.cookie) headers.Cookie = init.cookie;

  const res = await fetch(baseUrl + path, {
    method: init?.method ?? 'GET',
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, body: parsed as T };
}
