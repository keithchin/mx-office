// Edit in Studio Pro's calls answer JSON with the real reason whatever goes wrong, and every route a
// route module defines is one the office actually serves. On 2026-10-16 the button always said
// "Couldn't reach the office to bring the project folder up to date": POST /api/studio/sync was written
// (studioRoutes.sync) but never added to the office's route list, so the bundle's catch-all answered a
// plain-text 404 the page couldn't read. And test mode's opener never starts the Studio Pro installed
// on the machine running the tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { routes } from '../src/server/http/routes/index.js';
import { studioRouteDeps, studioRoutes } from '../src/server/http/routes/studio.js';
import { fakeMachine, fakeStudioOpens, machine, openInStudio } from '../src/server/studio/open.js';
import { useTestMode } from '../src/server/testmode.js';
import type { FloorSyncState, StudioInfo } from '../src/shared/studio.js';

type Handle = (c: unknown, r: unknown) => Promise<void> | void;
const ROUTES_DIR = path.join(import.meta.dirname, '..', 'src', 'server', 'http', 'routes');

test('every route a route module defines is in the office’s route list (POST /api/studio/sync was not)', async () => {
  const served = new Set<unknown>(routes);
  const missing: string[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts')) {
    const mod = (await import(pathToFileURL(path.join(ROUTES_DIR, file)).href)) as Record<string, unknown>;
    for (const [name, group] of Object.entries(mod)) {
      if (!group || typeof group !== 'object') continue;
      for (const [key, r] of Object.entries(group as Record<string, unknown>)) {
        const route = r as { handle?: unknown; path?: unknown; prefix?: unknown } | null;
        if (route && typeof route === 'object' && typeof route.handle === 'function' && ('path' in route || 'prefix' in route) && !served.has(route)) missing.push(`${file}: ${name}.${key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(served.has(studioRoutes.sync));
});

const floor = { id: 'shop', dir: 'C:\\floors\\shop', def: { name: 'Shop' }, workers: { list: () => [] } };
const SYNC: FloorSyncState = { floor: 'shop', state: 'current', branch: 'main', behind: 0, at: 1 };
const INFO: StudioInfo = { hasMpr: true, mpr: 'Shop.mpr', available: true, admin: true, busy: [] };

function call(route: { handle: unknown; path: string }, o: { origin?: string; admin?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { host: 'office.test', origin: o.origin ?? 'http://office.test', 'content-type': 'application/json' };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(o.body ?? { floor: 'shop' }))]), { method: 'POST', headers, socket: { remoteAddress: '127.0.0.1' } });
  let status = 0;
  let raw = '';
  const res = { headersSent: false, writeHead: (s: number) => ((status = s), (res.headersSent = true), res), end: (b: string) => void (raw = b), setHeader() {} };
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: o.admin ?? true }), floors: new Map([['shop', floor]]), toastFloor() {} };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: {} })).then(() => ({ status, body: JSON.parse(raw) as { error?: string; ok?: boolean } }));
}

/** Runs `fn` with some of the routes' deps stood in for, then puts the real ones back. */
async function withDeps(over: Partial<typeof studioRouteDeps>, fn: () => Promise<void>) {
  const real = { ...studioRouteDeps };
  Object.assign(studioRouteDeps, over);
  try {
    await fn();
  } finally {
    Object.assign(studioRouteDeps, real);
  }
}

test('POST /api/studio/sync: a throw anywhere is JSON with the real reason, never a bare 500', async () => {
  await withDeps({ syncFloorNow: async () => Promise.reject(new Error('spawn git ENOENT')) }, async () => {
    const r = await call(studioRoutes.sync);
    assert.equal(r.status, 500);
    assert.equal(r.body.error, "Couldn't bring the project folder up to date: spawn git ENOENT");
  });
  await withDeps({ syncFloorNow: async () => SYNC, studioInfo: () => { throw new Error('EPERM: operation not permitted, scandir'); } }, async () => {
    const r = await call(studioRoutes.sync);
    assert.equal(r.status, 500);
    assert.match(r.body.error ?? '', /^Couldn't bring the project folder up to date: EPERM/);
  });
  await withDeps({ syncFloorNow: async () => SYNC, studioInfo: () => INFO }, async () => {
    const r = await call(studioRoutes.sync);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { sync: SYNC, info: INFO });
  });
});

test('POST /api/studio/sync and /open: every refusal says what it is', async () => {
  await withDeps({ syncFloorNow: async () => assert.fail('a refusal never syncs') }, async () => {
    for (const route of [studioRoutes.sync, studioRoutes.open]) {
      const other = await call(route, { origin: 'http://localhost:9999' });
      assert.equal(other.status, 403);
      assert.equal(other.body.error, "Refused: the request didn't come from the office's own page (its Origin is http://localhost:9999, the office is at office.test)");
      const notAdmin = await call(route, { admin: false });
      assert.equal(notAdmin.status, 403);
      assert.equal(notAdmin.body.error, 'Only admins can open the project in Studio Pro');
      const none = await call(route, { body: { floor: 'nope' } });
      assert.equal(none.status, 404);
      assert.equal(none.body.error, 'No such project (nope)');
    }
  });
});

test('POST /api/studio/open: a throw is JSON with the reason; a machine that can’t open says why', async () => {
  await withDeps({ syncFloorNow: async () => SYNC, openInStudio: () => { throw new Error('spawn EACCES'); } }, async () => {
    const r = await call(studioRoutes.open);
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { ok: false, error: "Couldn't open the project in Studio Pro: spawn EACCES" });
  });
  await withDeps({ syncFloorNow: async () => SYNC, openInStudio: () => ({ ok: false, problem: 'not-installed', error: "Studio Pro 11.6.4 isn't installed on the office's computer" }) }, async () => {
    const r = await call(studioRoutes.open);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "Studio Pro 11.6.4 isn't installed on the office's computer");
  });
  await withDeps({ syncFloorNow: async () => SYNC, openInStudio: () => ({ ok: true, mpr: 'C:\\floors\\shop\\Shop.mpr', via: 'version-selector' }) }, async () => {
    const r = await call(studioRoutes.open);
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
  });
});

test('test mode never starts Studio Pro: its opener only records what it would have run', () => {
  const d = fakeMachine();
  const before = fakeStudioOpens().length;
  const opened = openInStudio('C:\\floors\\shop', { ...d, findMpr: () => 'C:\\floors\\shop\\Shop.mpr', readVersion: () => '11.12.4' });
  assert.deepEqual(opened, { ok: true, mpr: 'C:\\floors\\shop\\Shop.mpr', version: '11.12.4', via: 'version-selector' });
  const last = fakeStudioOpens().at(-1)!;
  assert.equal(fakeStudioOpens().length, before + 1);
  assert.match(last.cmd, /^C:\\MxOfficeTestMode\\/);
  assert.deepEqual(last.args, ['/file:C:\\floors\\shop\\Shop.mpr']);
  // The office in test mode uses it, whatever the machine has installed.
  useTestMode({ flag: true, agentCmd: 'fake', agentExplicit: true });
  try {
    assert.equal(machine().env.ProgramFiles, 'C:\\MxOfficeTestMode\\Program Files');
  } finally {
    useTestMode(undefined);
  }
});
