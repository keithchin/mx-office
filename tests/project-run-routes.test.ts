// ▶ Resume / ⏸ Pause project and 🔁 Restart safely stay admin-only: every route that changes anything
// refuses anyone else (not just a hidden button), and another site's page; a script may send JSON with
// no Origin. None of these refusals gets as far as the office's floors or its workflow engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { projectRunRoutes } from '../src/server/http/routes/project-run.js';

type Handle = (c: unknown, r: unknown) => Promise<void> | void;

function call(route: { handle: unknown; path: string }, opts: { origin?: string; type?: string; admin: boolean; body: unknown }) {
  const headers: Record<string, string> = { host: 'office.test', ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.type ? { 'content-type': opts.type } : {}) };
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(opts.body))]), { method: 'POST', headers });
  let status = 0;
  let body: unknown;
  const res = { writeHead: (s: number) => ((status = s), res), end: (b: string) => void (body = JSON.parse(b)), headersSent: false };
  // No floors and no engine: a refusal must come before either is touched.
  const ctx = { cfg: { trustProxy: false }, meOf: () => ({ admin: opts.admin }), floors: new Map() };
  return Promise.resolve((route.handle as Handle)(ctx, { req, res, url: new URL(`http://office.test${route.path}`), path: route.path, session: {} })).then(() => ({ status, body: body as { error?: string } }));
}

const ORIGIN = 'http://office.test';

test('POST /api/project-run: admins only, for every action and for all floors', async () => {
  for (const body of [{ floor: 'shop', action: 'resume' }, { floor: 'shop', action: 'pause' }, { floor: 'shop', action: 'cancel' }, { floor: 'shop', action: 'hold' }, { floor: 'shop', action: 'continue' }, { floor: 'shop', action: 'pacing', pacing: { concurrent: 3 } }, { all: true, action: 'resume' }, { all: true, action: 'pause' }]) {
    const r = await call(projectRunRoutes.act, { origin: ORIGIN, admin: false, body });
    assert.equal(r.status, 403, JSON.stringify(body));
    assert.match(r.body.error ?? '', /Project Manager \(an admin\)/);
  }
  // An admin gets past the check (to "no such floor": there are none here).
  assert.equal((await call(projectRunRoutes.act, { origin: ORIGIN, admin: true, body: { floor: 'shop', action: 'pause' } })).status, 404);
});

test('POST /api/office/restart: admins only, whatever the action', async () => {
  for (const action of ['start', 'wait', 'anyway', 'cancel']) {
    const r = await call(projectRunRoutes.restart, { origin: ORIGIN, admin: false, body: { action } });
    assert.equal(r.status, 403, action);
    assert.match(r.body.error ?? '', /Only admins/);
  }
});

test('another site’s page is refused; a script without an Origin must send JSON', async () => {
  for (const route of [projectRunRoutes.act, projectRunRoutes.restart]) {
    assert.equal((await call(route, { origin: 'https://evil.test', type: 'application/json', admin: true, body: {} })).status, 403);
    assert.equal((await call(route, { admin: true, body: {} })).status, 403, 'no Origin and not JSON (a form)');
    assert.equal((await call(route, { type: 'application/json', admin: false, body: {} })).status, 403, 'a script that isn’t an admin');
  }
});
