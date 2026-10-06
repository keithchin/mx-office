// The phone version over HTTP (http/routes/mobile.ts): its manifest, service worker and icons served
// to anyone, /m behind the sign-in, risky actions only with a fresh sign-in (server/mobile/), the
// password typed again (rate-limited), and the session cookie made Secure for the tunnel's origin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.ts';
import { Auth } from '../src/server/auth.ts';
import { requestHandler } from '../src/server/http/router.ts';
import { authRoutes } from '../src/server/http/routes/auth.ts';
import { MANIFEST, mobileRoutes } from '../src/server/http/routes/mobile.ts';
import { routes } from '../src/server/http/routes/index.ts';
import type { Ctx } from '../src/server/office/context.ts';
import { ReauthBook } from '../src/server/mobile/reauth.ts';
import { actionOf, runAction } from '../src/server/mobile/actions.ts';
import { setTunnelUrl } from '../src/server/phone-access/origin.ts';
import { freshAuth, isMergeOrder, isRisky, REAUTH_MS } from '../src/shared/mobile.ts';

async function office() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-mobile-'));
  const pub = path.join(dir, 'public');
  mkdirSync(path.join(pub, 'icons'), { recursive: true });
  writeFileSync(path.join(pub, 'sw.js'), 'self.addEventListener("push", () => {});');
  writeFileSync(path.join(pub, 'm.html'), '<!doctype html><title>Agent Office</title>');
  writeFileSync(path.join(pub, 'icons', 'icon-192.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const salt = randomBytes(16);
  const accounts = new Accounts(path.join(dir, 'data'));
  const floor = { id: 'f1', def: { name: 'Shop' }, github: { pulls: { items: [{ number: 7, title: 'Checkout', url: 'https://github.com/acme/shop/pull/7' }] } } };
  const cfg = { port: 0, trustProxy: false, dataDir: path.join(dir, 'data') };
  const ctx = {
    cfg,
    services: { lookup: () => undefined, list: () => [] },
    publicDir: pub,
    accounts,
    auth: new Auth(scryptSync('hunter2', salt, 32), salt, 'secret', accounts),
    floors: new Map([['f1', floor]]),
    meOf: () => ({ admin: true }),
  } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [authRoutes.login, mobileRoutes.manifest, mobileRoutes.worker, mobileRoutes.icons, mobileRoutes.reauth, mobileRoutes.act, mobileRoutes.page]));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  cfg.port = port;
  const base = `http://127.0.0.1:${port}`;
  return { ctx, base, port, close: () => server.close() };
}

test('manifest, service worker and icons are served to anyone; /m only signed in', async () => {
  const o = await office();
  try {
    const m = await fetch(`${o.base}/manifest.webmanifest`);
    assert.equal(m.status, 200);
    assert.equal(m.headers.get('content-type'), 'application/manifest+json');
    const j = await m.json();
    assert.equal(j.name, 'Agent Office');
    assert.equal(j.start_url, '/m');
    assert.equal(j.display, 'standalone');
    assert.ok(j.icons.some((i: { sizes: string }) => i.sizes === '512x512'));
    const sw = await fetch(`${o.base}/sw.js`);
    assert.equal(sw.status, 200);
    assert.match(sw.headers.get('content-type') ?? '', /javascript/);
    assert.equal(sw.headers.get('cache-control'), 'no-cache');
    assert.match(await sw.text(), /addEventListener\("push"/);
    assert.equal((await fetch(`${o.base}/icons/icon-192.png`)).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${o.base}/icons/..%2Fsw.js`)).status, 404);
    const page = await fetch(`${o.base}/m`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.equal(page.headers.get('location'), '/login?next=/m');
  } finally {
    o.close();
  }
});

test('the office lists them in that order: the manifest, worker and icons before the sign-in check', () => {
  const at = (r: unknown) => routes.indexOf(r as (typeof routes)[number]);
  const firstSession = routes.findIndex((r) => r.auth === 'session');
  for (const r of [mobileRoutes.manifest, mobileRoutes.worker, mobileRoutes.icons]) assert.ok(at(r) >= 0 && at(r) < firstSession);
  assert.ok(at(mobileRoutes.page) < routes.length - 1, '/m before the bundle catch-all');
  assert.deepEqual(MANIFEST.icons.map((i) => i.src).filter((s) => !s.startsWith('/icons/')), []);
});

test('a fresh sign-in: within 10 minutes of signing in, or of typing the password again', () => {
  let now = 1_000_000_000;
  const auth = new Auth(randomBytes(32), randomBytes(16), 'secret', { sharedPassword: true } as Accounts);
  const realNow = Date.now;
  Date.now = () => now;
  const token = auth.issue();
  Date.now = realNow;
  const book = new ReauthBook(() => now);
  assert.equal(book.fresh(token), true, 'just signed in');
  now += REAUTH_MS + 1;
  assert.equal(book.fresh(token), false, 'signed in 10 minutes ago');
  book.mark(token);
  assert.equal(book.fresh(token), true, 'password typed again');
  assert.equal(book.until(token), now + REAUTH_MS);
  now += REAUTH_MS;
  assert.equal(book.fresh(token), false);
  assert.equal(book.fresh(undefined), false);
  assert.equal(freshAuth(5, undefined, undefined), false);
});

test('which actions are risky', () => {
  const merge = { title: 'Merge order for #12 and #14', details: '', options: ['Merge #12 first'], trigger: 'plan' as const };
  const plain = { title: 'Which colour for the button?', details: '', options: ['Blue', 'Green'] };
  assert.equal(isMergeOrder(merge), true);
  assert.equal(isRisky({ do: 'merge' }), true);
  assert.equal(isRisky({ do: 'hire' }), true);
  assert.equal(isRisky({ do: 'raise-cap' }), true);
  assert.equal(isRisky({ do: 'escalation', verdict: 'approve' }, merge), true);
  assert.equal(isRisky({ do: 'escalation', verdict: 'reject' }, merge), false);
  assert.equal(isRisky({ do: 'escalation', verdict: 'approve' }, plain), false);
  assert.equal(isRisky({ do: 'escalation', verdict: 'approve' }, { ...plain, trigger: 'security' }), true);
  assert.equal(isRisky({ do: 'pause' }), false);
});

test('a risky action without a fresh sign-in is refused; with one it goes, and pause is a slot', async () => {
  const o = await office();
  try {
    const merge = actionOf({ do: 'merge', floor: 'f1', number: 7 });
    assert.equal(typeof merge, 'object');
    const who = { name: 'Pat', admin: true, fresh: false };
    assert.deepEqual(await runAction(o.ctx, merge as Exclude<typeof merge, string>, who), { ok: false, status: 401, error: 'Confirm with your password first', reauth: true });
    const ok = await runAction(o.ctx, merge as Exclude<typeof merge, string>, { ...who, fresh: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.url, 'https://github.com/acme/shop/pull/7');
    assert.deepEqual(await runAction(o.ctx, merge as Exclude<typeof merge, string>, { ...who, admin: false, fresh: true }), { ok: false, status: 403, error: 'Only the Project Manager (an admin) can do that' });
    const pause = actionOf({ do: 'pause', floor: 'f1' });
    const r = await runAction(o.ctx, pause as Exclude<typeof pause, string>, who);
    assert.equal(!r.ok && r.status, 501);
    assert.equal(actionOf({ do: 'raise-cap', floor: 'f1', amount: -3 }), 'A cap in dollars, more than 0');
  } finally {
    o.close();
  }
});

async function login(base: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ password: 'hunter2' }) });
  return { status: r.status, cookie: r.headers.get('set-cookie') ?? '' };
}

test('typing the password again: a wrong one is refused, the right one lets risky actions through', async () => {
  const o = await office();
  try {
    const { cookie } = await login(o.base);
    const c = cookie.split(';')[0];
    const reauth = (password: string) => fetch(`${o.base}/api/m/reauth`, { method: 'POST', headers: { cookie: c, origin: o.base, 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    assert.equal((await reauth('nope')).status, 401);
    const ok = await reauth('hunter2');
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).reauthUntil > Date.now());
    const act = await fetch(`${o.base}/api/m/act`, { method: 'POST', headers: { cookie: c, origin: o.base, 'content-type': 'application/json' }, body: JSON.stringify({ do: 'merge', floor: 'f1', number: 7 }) });
    assert.equal(act.status, 200);
    // Another site can't do it with the cookie.
    const cross = await fetch(`${o.base}/api/m/act`, { method: 'POST', headers: { cookie: c, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ do: 'merge', floor: 'f1', number: 7 }) });
    assert.equal(cross.status, 403);
    // Guessing is rate-limited like signing in.
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await reauth('wrong')).status;
    assert.equal(last, 429);
  } finally {
    o.close();
  }
});

test('through the tunnel the session cookie is Secure and same-origin is the tunnel host', async () => {
  const o = await office();
  try {
    assert.doesNotMatch((await login(o.base)).cookie, /Secure/);
    setTunnelUrl('https://x7abc-4600.euw.devtunnels.ms');
    const via = await login(o.base, { 'x-forwarded-host': 'x7abc-4600.euw.devtunnels.ms', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.9' });
    assert.equal(via.status, 200);
    assert.match(via.cookie, /; Secure/);
    const c = via.cookie.split(';')[0];
    const act = await fetch(`${o.base}/api/m/act`, { method: 'POST', headers: { cookie: c, origin: 'https://x7abc-4600.euw.devtunnels.ms', 'x-forwarded-host': 'x7abc-4600.euw.devtunnels.ms', 'content-type': 'application/json' }, body: JSON.stringify({ do: 'pause', floor: 'f1' }) });
    assert.equal(act.status, 501, 'past the same-origin check');
    // Someone else's forwarded host from loopback is not the tunnel.
    assert.doesNotMatch((await login(o.base, { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' })).cookie, /Secure/);
  } finally {
    setTunnelUrl(undefined);
    o.close();
  }
});
