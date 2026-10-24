// The office's Origin / request-token rule for signed-in, state-changing routes (server/http/origin.ts): the
// office's own page (matching Origin) and a tool with the session's token get through; a bare no-Origin JSON
// POST from elsewhere, or another site's Origin, is refused before any route runs. Reads are never refused,
// and the agents' own routes (public here, the hook port in the office) never meet the rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { requestHandler, type Route } from '../src/server/http/router.js';
import { csrfTokenOf, CSRF_HEADER, REFUSED, fromOffice } from '../src/server/http/origin.js';
import { csrfRoutes } from '../src/server/http/routes/csrf.js';
import { routes as officeRoutes } from '../src/server/http/routes/index.js';
import { send } from '../src/server/http/util.js';
import { COOKIE_NAME } from '../src/server/auth.js';

const HOST = 'office.test:4600';
const COOKIE = 'abc.def';
// The office's session cookie on port 4600 (auth.ts cookieName), the one the token is tied to.
const cookie = `${COOKIE_NAME}_4600=${COOKIE}`;

let ran = 0;
const routes: Route[] = [
  { method: 'POST', path: '/office/hook', auth: 'public', handle: (_c, { res }) => send(res, 200, { hook: true }) },
  csrfRoutes.token,
  { path: '/api/thing', auth: 'session', handle: (_c, { res }) => ((ran++), send(res, 200, { ok: true })) },
];

function call(method: string, path: string, headers: Record<string, string>) {
  const req = Object.assign(Readable.from([Buffer.from('{}')]), { method, url: path, headers: { host: HOST, ...headers }, socket: { remoteAddress: '127.0.0.1' } }) as unknown as http.IncomingMessage;
  let status = 0;
  let body = '';
  const res = { headersSent: false, writeHead: (s: number) => ((status = s), res), end: (b?: string) => void (body = b ?? '') } as unknown as http.ServerResponse;
  const ctx = {
    cfg: { port: 4600, trustProxy: false },
    services: { lookup: () => undefined },
    auth: { fromAnyCookie: () => false, fromRequest: (r: http.IncomingMessage) => ((r.headers.cookie ?? '').includes(COOKIE) ? {} : undefined) },
  };
  return Promise.resolve(requestHandler(ctx as never, routes)(req, res)).then(() => ({ status, body: body ? JSON.parse(body) : undefined }));
}

const JSON_T = { 'content-type': 'application/json' };

test('the office page (matching Origin) changes things; a read needs no Origin', async () => {
  ran = 0;
  assert.equal((await call('POST', '/api/thing', { cookie, origin: `http://${HOST}`, ...JSON_T })).status, 200);
  assert.equal((await call('GET', '/api/thing', { cookie })).status, 200);
  assert.equal(ran, 2);
});

test('a bare no-Origin JSON POST is refused before the route runs, and so is another site', async () => {
  ran = 0;
  for (const h of [{ cookie, ...JSON_T }, { cookie, origin: 'https://elsewhere.test', ...JSON_T }, { cookie, origin: 'null', ...JSON_T }, { cookie, [CSRF_HEADER]: 'nope', ...JSON_T }]) {
    const r = await call('POST', '/api/thing', h);
    assert.equal(r.status, 403, JSON.stringify(h));
    assert.equal(r.body.error, REFUSED);
  }
  // Any other method that changes things too.
  assert.equal((await call('PUT', '/api/thing', { cookie, ...JSON_T })).status, 403);
  assert.equal(ran, 0, 'no route ran');
});

test('a tool (office CLI, a script) with the session’s token from GET /api/csrf gets through', async () => {
  ran = 0;
  const t = await call('GET', '/api/csrf', { cookie });
  assert.equal(t.status, 200);
  assert.equal(t.body.header, CSRF_HEADER);
  assert.equal(t.body.token, csrfTokenOf(COOKIE));
  assert.notEqual(t.body.token, COOKIE, 'the token is not the cookie');
  assert.equal((await call('POST', '/api/thing', { cookie, [CSRF_HEADER]: t.body.token, ...JSON_T })).status, 200);
  // Another session's token doesn't do for this one.
  assert.equal((await call('POST', '/api/thing', { cookie, [CSRF_HEADER]: csrfTokenOf('other.cookie'), ...JSON_T })).status, 403);
  assert.equal(ran, 1);
});

test('the agents’ hook calls and other public routes never meet the rule; no session is still a 401', async () => {
  assert.deepEqual(await call('POST', '/office/hook', JSON_T), { status: 200, body: { hook: true } });
  assert.equal((await call('POST', '/api/thing', JSON_T)).status, 401);
  // The office's agent endpoints (/office/*, the hook port) aren't signed-in HTTP routes at all.
  assert.ok(!officeRoutes.some((r) => r.auth === 'session' && typeof r.path === 'string' && r.path.startsWith('/office/')));
});

test('fromOffice: the routes’ own check is the same rule', () => {
  const req = (headers: Record<string, string>) => ({ headers: { host: HOST, ...headers } }) as unknown as http.IncomingMessage;
  assert.equal(fromOffice(req({ origin: `http://${HOST}` }), { trustProxy: false }), true);
  assert.equal(fromOffice(req({ ...JSON_T }), { trustProxy: false }), false, 'JSON without an Origin no longer counts as the office');
  assert.equal(fromOffice(req({ cookie, [CSRF_HEADER]: csrfTokenOf(COOKIE) }), { trustProxy: false }), true);
});

test('no route keeps the old "JSON with no Origin counts as ours" rule, and the desktop app sends its Origin', () => {
  for (const f of ['merge-gate', 'progress', 'decisions', 'project-run', 'design-import']) assert.doesNotMatch(readFileSync(`src/server/http/routes/${f}.ts`, 'utf8'), /!req\.headers\.origin|req\.headers\.origin \|\|/, f);
  assert.match(readFileSync('desktop/src/main.ts', 'utf8'), /origin: new URL\(PROBE\)\.origin/);
});
