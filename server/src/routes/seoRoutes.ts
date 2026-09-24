import { Router, type Request, type Response } from 'express';
import { getActiveGames } from '../games/GameService';
import { getTournamentsWithGameInfo } from '../games/TournamentService';
import { getDb } from '../db/db';
import { PRODUCTION_FRONTEND_URL } from '../config/env';

/**
 * SEO Fix 1 — API-origin robots + dynamic sitemap.
 *
 * The canonical website origin is `PRODUCTION_FRONTEND_URL`. This API origin
 * must NOT be treated as a second copy of the site, so `/robots.txt` here
 * disallows crawling (while still allowing uploaded media so images that the
 * frontend references remain fetchable), and the app's catch-all marks the
 * served SPA shell `noindex`.
 *
 * `/sitemap.xml` lists ONLY real canonical public website URLs (static pages,
 * active games, visible tournaments, and claimed player profiles). URLs are
 * built from `PRODUCTION_FRONTEND_URL`, never from this host.
 */

export const seoRoutes = Router();

const STATIC_PUBLIC_PATHS = ['/', '/games', '/stream-games', '/leaderboard', '/links'];
const SITEMAP_TOURNAMENT_STATUSES = new Set(['open', 'active', 'completed']);

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      default: return '&quot;';
    }
  });
}

function collectPublicPaths(): string[] {
  const paths: string[] = [...STATIC_PUBLIC_PATHS];

  // Active public games.
  try {
    for (const game of getActiveGames()) {
      paths.push(`/stream-games/${encodeURIComponent(game.id)}`);
    }
  } catch {
    // Static URLs remain valid even if the catalog read fails.
  }

  // Public (non-hidden) tournaments in a competitive state.
  try {
    for (const tournament of getTournamentsWithGameInfo()) {
      if (tournament.hidden_at !== null) continue;
      if (!SITEMAP_TOURNAMENT_STATUSES.has(tournament.status)) continue;
      paths.push(`/tournaments/${encodeURIComponent(tournament.id)}`);
    }
  } catch {
    // Static URLs remain valid even if the tournament read fails.
  }

  // Claimed (website-linked) player profiles only.
  try {
    const rows = getDb()
      .prepare('SELECT DISTINCT player_id FROM guests WHERE claimed_user_id IS NOT NULL')
      .all() as { player_id: string }[];
    for (const row of rows) {
      paths.push(`/player/${encodeURIComponent(row.player_id)}`);
    }
  } catch {
    // Player URLs are optional; a failure must not break the sitemap.
  }

  return paths;
}

/** API origin is not the canonical site: block crawling, keep uploads fetchable. */
seoRoutes.get('/robots.txt', (_req: Request, res: Response) => {
  const body = [
    'User-agent: *',
    'Disallow: /',
    'Allow: /api/uploads/',
    '',
  ].join('\n');
  res.type('text/plain').send(body);
});

seoRoutes.get('/sitemap.xml', (_req: Request, res: Response) => {
  const base = PRODUCTION_FRONTEND_URL.replace(/\/+$/, '');
  const entries = collectPublicPaths()
    .map((path) => {
      const loc = path === '/' ? `${base}/` : `${base}${path}`;
      return `  <url>\n    <loc>${escapeXml(loc)}</loc>\n  </url>`;
    })
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries +
    '\n</urlset>\n';

  res.type('application/xml').send(xml);
});
