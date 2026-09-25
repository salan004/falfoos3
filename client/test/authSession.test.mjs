/**
 * Phase 1 auth hardening — frontend regression tests.
 *
 * The client has no test framework, so this is a plain Node ESM script. It
 * loads the real `useAuthSession` module through Vite's SSR module loader
 * (which resolves `import.meta.env` and TypeScript) and drives the exported
 * singleton API with a stubbed global `fetch`.
 *
 * Place is `client/test/` (outside `client/src`) so `tsc`/`vite build` never
 * include it.
 *
 * Run: `node client/test/authSession.test.mjs` (from the repository root).
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

/** Minimal Response substitute: only `.ok` and `.json()` are used by the hook. */
function res(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** A 2xx response whose body cannot be parsed as JSON. */
function invalidJsonRes(status = 200) {
  return {
    ok: true,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  };
}

let calls = [];
function stubFetch(impl) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  };
}

const vite = await createServer({
  root: clientRoot,
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  cacheDir: path.join(os.tmpdir(), 'falfoos-vite-auth-test'),
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});

const auth = await vite.ssrLoadModule('/src/hooks/useAuthSession.ts');
const reset = () => auth.__resetAuthSessionForTests();

const USER = { id: 'u1', displayName: 'Falfoos', role: 'user' };

await test('200 + user -> authenticated', async () => {
  reset();
  stubFetch(async () => res(200, { user: USER, guestLinked: true }));
  const state = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(state.user.id, 'u1');
  assert.equal(state.guestLinked, true);
  assert.equal(state.error, false);
});

await test('/api/auth/me is requested with cache: "no-store"', async () => {
  reset();
  stubFetch(async () => res(200, { user: null, guestLinked: false }));
  await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/auth/me');
  assert.equal(calls[0].init.cache, 'no-store');
});

await test('200 + user:null -> guest (resolved, not error)', async () => {
  reset();
  stubFetch(async () => res(200, { user: null, guestLinked: false }));
  const state = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(state.user, null);
  assert.equal(state.error, false);
});

for (const status of [500, 502, 503]) {
  await test(`${status} -> retryable error, never a permanent guest`, async () => {
    reset();
    stubFetch(async () => res(status, { error: 'boom' }));
    const state = await auth.refreshAuthSession({ retries: 1, delayMs: 0 });
    assert.equal(state.user, undefined, 'must stay unknown, not null');
    assert.equal(state.error, true);
    assert.ok(calls.length >= 1, 'at least one attempt made');
  });
}

await test('invalid JSON -> retryable error, never a permanent guest', async () => {
  reset();
  stubFetch(async () => invalidJsonRes(200));
  const state = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(state.user, undefined);
  assert.equal(state.error, true);
});

await test('network failure then success -> authenticated via bounded retry', async () => {
  reset();
  let n = 0;
  stubFetch(async () => {
    n += 1;
    if (n === 1) throw new Error('network down');
    return res(200, { user: USER, guestLinked: false });
  });
  const state = await auth.refreshAuthSession({ retries: 1, delayMs: 0 });
  assert.equal(state.user.id, 'u1');
  assert.equal(state.error, false);
  assert.equal(n, 2, 'first failed then retried once');
});

await test('after a terminal error a later refresh recovers to guest', async () => {
  reset();
  let n = 0;
  stubFetch(async () => {
    n += 1;
    if (n === 1) return res(500, { error: 'boom' });
    return res(200, { user: null, guestLinked: false });
  });
  await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(auth.getAuthState().user, undefined);
  const recovered = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(recovered.user, null);
  assert.equal(recovered.error, false);
});

await test('concurrent consumers share exactly one request', async () => {
  reset();
  let release;
  stubFetch(
    () =>
      new Promise((resolve) => {
        release = () => resolve(res(200, { user: USER, guestLinked: false }));
      })
  );
  const a = auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  const b = auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  const c = auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  release();
  await Promise.all([a, b, c]);
  assert.equal(calls.length, 1, 'one shared /api/auth/me request');
  assert.equal(auth.getAuthState().user.id, 'u1');
});

await test('authenticated refresh failure preserves the user (no downgrade to guest)', async () => {
  reset();
  let n = 0;
  stubFetch(async () => {
    n += 1;
    if (n === 1) return res(200, { user: USER, guestLinked: false });
    return res(503, { error: 'unavailable' });
  });
  const first = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(first.user.id, 'u1');
  const second = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(second.user.id, 'u1', 'user preserved during transient failure');
  assert.equal(second.error, true);
});

await test('logout race: an in-flight auth read cannot restore the old user', async () => {
  reset();
  let releaseMe;
  stubFetch((url) => {
    if (url.includes('/api/auth/logout')) return Promise.resolve(res(204, null));
    return new Promise((resolve) => {
      releaseMe = () => resolve(res(200, { user: USER, guestLinked: true }));
    });
  });
  const mePromise = auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  const logoutPromise = auth.logoutAuthSession();
  releaseMe();
  await Promise.all([mePromise, logoutPromise]);
  assert.equal(auth.getAuthState().user, null, 'stale authenticated user must not return');
  assert.equal(auth.getAuthState().guestLinked, false);
});

await test('logout clears an authenticated state set before it', async () => {
  reset();
  stubFetch(async (url) => {
    if (url.includes('/api/auth/logout')) return res(204, null);
    return res(200, { user: USER, guestLinked: false });
  });
  await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(auth.getAuthState().user.id, 'u1');
  await auth.logoutAuthSession();
  assert.equal(auth.getAuthState().user, null);
  assert.equal(auth.getAuthState().error, false);
});

await test('authenticated -> guest is only committed on an explicit 200 {user:null}', async () => {
  reset();
  let n = 0;
  stubFetch(async () => {
    n += 1;
    if (n === 1) return res(200, { user: USER, guestLinked: false });
    return res(200, { user: null, guestLinked: false });
  });
  await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  const state = await auth.refreshAuthSession({ retries: 0, delayMs: 0 });
  assert.equal(state.user, null);
  assert.equal(state.error, false);
});

await vite.close();

console.log(`\nauthSession: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
