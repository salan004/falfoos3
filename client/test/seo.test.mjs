/**
 * SEO Fix 1 — frontend routing + metadata regression tests.
 *
 * Plain Node ESM: loads the real `useRoute` and `seo` modules through Vite's
 * SSR loader (which resolves TypeScript and `import.meta`), then drives their
 * pure/testable exports. A minimal fake `document` lets us assert the actual
 * <head> writer without a DOM library.
 *
 * Run: `node client/test/seo.test.mjs` (from the repository root).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');
const repoRoot = path.resolve(clientRoot, '..');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  \u2717 ${name}`);
    console.error(`      ${err && err.stack ? err.stack : err}`);
  }
}

// --- minimal DOM for applySeo -------------------------------------------------
const head = [];
function makeEl(tag) {
  return {
    tagName: tag,
    _attrs: {},
    textContent: '',
    id: '',
    setAttribute(k, v) {
      this._attrs[k] = v;
      if (k === 'id') this.id = v;
    },
    getAttribute(k) {
      return this._attrs[k];
    },
    remove() {
      const i = head.indexOf(this);
      if (i >= 0) head.splice(i, 1);
    },
  };
}
function matches(el, selector) {
  let m;
  if ((m = selector.match(/^meta\[name="(.+)"\]$/))) {
    return el.tagName === 'meta' && el.getAttribute('name') === m[1];
  }
  if ((m = selector.match(/^meta\[property="(.+)"\]$/))) {
    return el.tagName === 'meta' && el.getAttribute('property') === m[1];
  }
  if (selector === 'link[rel="canonical"]') {
    return el.tagName === 'link' && el.getAttribute('rel') === 'canonical';
  }
  return false;
}
globalThis.document = {
  title: '',
  head: {
    querySelector: (sel) => head.find((el) => matches(el, sel)) ?? null,
    appendChild: (el) => {
      head.push(el);
      return el;
    },
  },
  createElement: (tag) => makeEl(tag),
  getElementById: (id) => head.find((el) => el.id === id) ?? null,
};

const vite = await createServer({
  root: clientRoot,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: path.join(os.tmpdir(), 'falfoos-vite-seo-test'),
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const route = await vite.ssrLoadModule('/src/hooks/useRoute.ts');
const seo = await vite.ssrLoadModule('/src/seo/seo.ts');

// --- routing ------------------------------------------------------------------
await test('matchTournamentRoute matches /tournaments/:id only', () => {
  assert.deepEqual(route.matchTournamentRoute('/tournaments/abc-123'), { tournamentId: 'abc-123' });
  assert.equal(route.matchTournamentRoute('/tournaments'), null);
  assert.equal(route.matchTournamentRoute('/tournaments/a/b'), null);
});

await test('matchPlayerRoute parses id + tournamentId + gameId query', () => {
  assert.deepEqual(route.matchPlayerRoute('/player/p1?gameId=g1&tournamentId=t1'), {
    playerId: 'p1',
    tournamentId: 't1',
    gameId: 'g1',
  });
  assert.deepEqual(route.matchPlayerRoute('/player/p1'), {
    playerId: 'p1',
    tournamentId: undefined,
    gameId: undefined,
  });
});

await test('matchStreamGamesRoute / matchGameTournamentsRoute / matchGameRoute', () => {
  assert.deepEqual(route.matchStreamGamesRoute('/stream-games/abc_DEF-1'), { gameId: 'abc_DEF-1' });
  assert.deepEqual(route.matchGameTournamentsRoute('/games/abc-1'), { gameId: 'abc-1' });
  assert.deepEqual(route.matchGameRoute('/game/trivia'), { gameId: 'trivia' });
});

await test('matchProfileRoute handles own and public profiles', () => {
  assert.deepEqual(route.matchProfileRoute('/profile'), { playerId: undefined });
  assert.deepEqual(route.matchProfileRoute('/profile/user:abc'), { playerId: 'user:abc' });
});

await test('matchRegisterRoute / matchBroadcastRoute / admin routes', () => {
  assert.equal(route.matchRegisterRoute('/register'), true);
  assert.deepEqual(route.matchBroadcastRoute('/broadcast/t-1'), { tournamentId: 't-1' });
  assert.equal(route.matchAdminGamesRoute('/dashboard/games'), true);
  assert.equal(route.matchAdminLiveRoute('/dashboard/live'), true);
});

// --- legacy hash migration ----------------------------------------------------
await test('legacyHashToPath converts #/ routes and preserves params', () => {
  assert.equal(route.legacyHashToPath('#/tournaments/abc?x=1'), '/tournaments/abc?x=1');
  assert.equal(route.legacyHashToPath('#/player/p1?gameId=g1'), '/player/p1?gameId=g1');
  assert.equal(route.legacyHashToPath('#/'), '/');
});

await test('legacyHashToPath ignores non-route hashes', () => {
  assert.equal(route.legacyHashToPath(''), null);
  assert.equal(route.legacyHashToPath('#foo'), null);
  assert.equal(route.legacyHashToPath('#section-2'), null);
});

// --- canonical + JSON-LD ------------------------------------------------------
await test('canonicalUrl strips query/hash and trailing slashes', () => {
  assert.equal(seo.canonicalUrl('/'), 'https://falfoos.com/');
  assert.equal(seo.canonicalUrl('/tournaments/abc?x=1#y'), 'https://falfoos.com/tournaments/abc');
  assert.equal(seo.canonicalUrl('/games/'), 'https://falfoos.com/games');
});

await test('breadcrumbList produces a valid BreadcrumbList', () => {
  const jsonLd = seo.breadcrumbList([
    { name: 'FalFoos', path: '/' },
    { name: 'Tournament', path: '/tournaments/abc' },
  ]);
  assert.equal(jsonLd['@type'], 'BreadcrumbList');
  assert.equal(jsonLd.itemListElement.length, 2);
  assert.equal(jsonLd.itemListElement[1].item, 'https://falfoos.com/tournaments/abc');
});

// --- applySeo <head> writer ---------------------------------------------------
await test('applySeo writes title, description, canonical, OG and Twitter tags', () => {
  head.length = 0;
  seo.applySeo({ title: 'T', description: 'D', path: '/tournaments/abc?x=1' });
  assert.equal(document.title, 'T');
  const get = (name) => head.find((el) => el.getAttribute('name') === name)?.getAttribute('content');
  assert.equal(get('description'), 'D');
  assert.equal(get('twitter:card'), 'summary_large_image');
  const canonical = head.find((el) => el.getAttribute('rel') === 'canonical');
  assert.equal(canonical.getAttribute('href'), 'https://falfoos.com/tournaments/abc');
  const ogUrl = head.find((el) => el.getAttribute('property') === 'og:url');
  assert.equal(ogUrl.getAttribute('content'), 'https://falfoos.com/tournaments/abc');
  const ogTitle = head.find((el) => el.getAttribute('property') === 'og:title');
  assert.equal(ogTitle.getAttribute('content'), 'T');
});

await test('applySeo marks private routes noindex and clears stale JSON-LD', () => {
  head.length = 0;
  seo.applySeo({ title: 'X', description: 'D', path: '/register', robots: 'noindex,nofollow' });
  const robots = head.find((el) => el.getAttribute('name') === 'robots');
  assert.equal(robots.getAttribute('content'), 'noindex,nofollow');
  assert.equal(head.find((el) => el.id === 'falfoos-route-jsonld'), undefined);
});

await test('applySeo injects route JSON-LD when provided', () => {
  head.length = 0;
  seo.applySeo({
    title: 'T',
    description: 'D',
    path: '/tournaments/abc',
    jsonLd: [seo.breadcrumbList([{ name: 'FalFoos', path: '/' }])],
  });
  const script = head.find((el) => el.id === 'falfoos-route-jsonld');
  assert.ok(script, 'json-ld script exists');
  assert.ok(script.textContent.includes('BreadcrumbList'));
});

// --- config deliverables ------------------------------------------------------
await test('client/public/robots.txt exists with correct directives', () => {
  const file = path.join(clientRoot, 'public', 'robots.txt');
  assert.ok(fs.existsSync(file), 'robots.txt exists');
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.includes('User-agent: *'));
  assert.ok(content.includes('Disallow: /dashboard'));
  assert.ok(content.includes('Sitemap: https://falfoos.com/sitemap.xml'));
});

await test('vercel.json defines the SPA fallback + sitemap rewrite without touching assets', () => {
  const file = path.join(repoRoot, 'client', 'vercel.json');
  assert.ok(fs.existsSync(file), 'vercel.json exists');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  const spa = config.rewrites.find((r) => r.destination === '/index.html');
  assert.ok(spa, 'SPA fallback present');
  assert.ok(spa.source.includes('assets/'), 'assets excluded');
  assert.ok(spa.source.includes('api/'), 'api excluded');
  const sitemap = config.rewrites.find((r) => r.source === '/sitemap.xml');
  assert.ok(sitemap && sitemap.destination.includes('api.falfoos.com'), 'sitemap proxied to API');
});

await vite.close();

console.log(`\nseo: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
