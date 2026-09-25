/**
 * Routing regression tests — shared History API route store.
 *
 * Guards the production regression where a child `navigate()` updated only its
 * own `useRoute()` instance (because `history.pushState` emits no event), so
 * `MainApp` stayed on the old route until a manual refresh.
 *
 * Loads the real `useRoute` module through Vite's SSR loader (resolves
 * TypeScript) and drives the exported `__routeStoreForTests` store API with a
 * stubbed `window`/`history`/`location`. No React renderer is required: the
 * tests exercise the exact shared store that `useSyncExternalStore` consumes.
 *
 * Run: `node client/test/useRoute.test.mjs` (from the repository root).
 */

import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(here, '..');

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

// --- minimal window/history/location stub ------------------------------------
let pushStateCalls = [];
let replaceStateCalls = [];
let popListeners = new Set();

function applyUrl(url) {
  const loc = globalThis.window.location;
  let rest = String(url ?? '');
  const hashIdx = rest.indexOf('#');
  if (hashIdx >= 0) {
    loc.hash = rest.slice(hashIdx);
    rest = rest.slice(0, hashIdx);
  } else {
    loc.hash = '';
  }
  const qIdx = rest.indexOf('?');
  if (qIdx >= 0) {
    loc.search = rest.slice(qIdx);
    loc.pathname = rest.slice(0, qIdx) || '/';
  } else {
    loc.search = '';
    loc.pathname = rest || '/';
  }
}

function installDom(init = {}) {
  pushStateCalls = [];
  replaceStateCalls = [];
  popListeners = new Set();
  globalThis.window = {
    location: {
      pathname: init.pathname ?? '/',
      search: init.search ?? '',
      hash: init.hash ?? '',
    },
    history: {
      pushState(_state, _title, url) {
        pushStateCalls.push(url);
        applyUrl(url);
      },
      replaceState(_state, _title, url) {
        replaceStateCalls.push(url);
        applyUrl(url);
      },
    },
    addEventListener(type, fn) {
      if (type === 'popstate') popListeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === 'popstate') popListeners.delete(fn);
    },
  };
}

const vite = await createServer({
  root: clientRoot,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: path.join(os.tmpdir(), 'falfoos-vite-route-test'),
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const route = await vite.ssrLoadModule('/src/hooks/useRoute.ts');
const store = route.__routeStoreForTests;

// --- A. shared state (the exact production regression) -----------------------
await test('A. two consumers share one route store; A.navigate -> B observes it', () => {
  installDom({ pathname: '/games' });
  store.reset();

  const aSeen = [];
  const bSeen = [];
  const unsubA = store.subscribe(() => aSeen.push(store.getPath()));
  const unsubB = store.subscribe(() => bSeen.push(store.getPath()));

  store.navigate('/games/trivia');

  assert.equal(store.getPath(), '/games/trivia', 'shared path updated');
  assert.deepEqual(aSeen, ['/games/trivia'], 'consumer A notified');
  assert.deepEqual(bSeen, ['/games/trivia'], 'consumer B notified (was the bug)');
  assert.ok(pushStateCalls.includes('/games/trivia'), 'pushState used');
  assert.equal(globalThis.window.location.pathname, '/games/trivia', 'URL changed');

  unsubA();
  unsubB();
});

// --- B. game-card style navigation -------------------------------------------
await test('B. game-card navigation updates the shared route (no refresh)', () => {
  installDom({ pathname: '/games' });
  store.reset();

  const page = [];
  const unsub = store.subscribe(() => page.push(store.getPath()));

  store.navigate('/games/trivia'); // e.g. GamesPage.openGame('trivia')

  assert.equal(store.getPath(), '/games/trivia');
  assert.equal(globalThis.window.location.pathname, '/games/trivia');
  assert.deepEqual(page, ['/games/trivia']);
  assert.equal(route.matchGameRoute('/games/trivia'), null, 'game hub, not /game/:id');
  unsub();
});

// --- C. home / icon style navigation -----------------------------------------
await test('C. home icon navigation propagates to the shared route', () => {
  installDom({ pathname: '/' });
  store.reset();

  const seen = [];
  const unsub = store.subscribe(() => seen.push(store.getPath()));

  store.navigate('/leaderboard'); // e.g. HomePage.handleOrbClick

  assert.equal(store.getPath(), '/leaderboard');
  assert.deepEqual(seen, ['/leaderboard']);
  unsub();
});

// --- D. direct initial route -------------------------------------------------
await test('D. direct initial route /games resolves to "/games"', () => {
  installDom({ pathname: '/games' });
  store.reset();
  assert.equal(store.getPath(), '/games');
  assert.equal(pushStateCalls.length, 0, 'initialization must not push history');
});

// --- E. nested route ---------------------------------------------------------
await test('E. nested route /tournaments/<id> resolves correctly', () => {
  installDom({ pathname: '/tournaments/abc-123' });
  store.reset();
  assert.equal(store.getPath(), '/tournaments/abc-123');
  assert.equal(route.matchTournamentRoute(store.getPath()).tournamentId, 'abc-123');
});

await test('E2. trailing-slash normalization is preserved', () => {
  installDom({ pathname: '/games/' });
  store.reset();
  assert.equal(store.getPath(), '/games');
});

// --- F. back / forward -------------------------------------------------------
await test('F. popstate (Back/Forward) updates all subscribers', () => {
  installDom({ pathname: '/' });
  store.reset();

  const seen = [];
  const unsub = store.subscribe(() => seen.push(store.getPath()));

  // Browser Back/Forward changes the URL first, then fires popstate.
  globalThis.window.location.pathname = '/tournaments/abc-123';
  store.handlePopState();

  assert.equal(store.getPath(), '/tournaments/abc-123');
  assert.deepEqual(seen, ['/tournaments/abc-123']);
  unsub();
});

await test('F2. a single module-level popstate listener is registered (not per consumer)', () => {
  installDom({ pathname: '/' });
  store.reset();

  assert.equal(popListeners.size, 0, 'nothing subscribed yet');
  const unsubA = store.subscribe(() => {});
  const unsubB = store.subscribe(() => {});
  assert.equal(popListeners.size, 1, 'one listener for any number of consumers');
  unsubA();
  unsubB();
});

// --- G. legacy hash migration ------------------------------------------------
await test('G. legacy #/games migrates to /games via replaceState (no extra entry)', () => {
  installDom({ pathname: '/', hash: '#/games' });
  store.reset();

  assert.equal(store.getPath(), '/games', 'migrated path');
  assert.deepEqual(replaceStateCalls, ['/games'], 'used replaceState, not pushState');
  assert.equal(pushStateCalls.length, 0, 'no extra history entry');
  assert.equal(globalThis.window.location.hash, '');
  assert.equal(globalThis.window.location.pathname, '/games');
});

await test('G2. legacyHashToPath keeps prior semantics', () => {
  assert.equal(route.legacyHashToPath('#/games?x=1'), '/games?x=1');
  assert.equal(route.legacyHashToPath('#section'), null);
  assert.equal(route.legacyHashToPath(''), null);
});

// --- H. navigate no-ops when already on the destination ----------------------
await test('H. navigating to the current route does not push or notify', () => {
  installDom({ pathname: '/games' });
  store.reset();

  const seen = [];
  const unsub = store.subscribe(() => seen.push(store.getPath()));

  store.navigate('/games');

  assert.equal(pushStateCalls.length, 0, 'no redundant history entry');
  assert.deepEqual(seen, [], 'no subscriber notification');
  unsub();
});

await vite.close();

console.log(`\nuseRoute: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
