// Risky desktop actions through 📱 Phone access's tunnel need the password again (server/phone-access/reauth.ts,
// server/ws/reauth.ts, client/ui/reauth.ts); on the office's own address nothing changes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.ts';
import { Auth } from '../src/server/auth.ts';
import { requestHandler } from '../src/server/http/router.ts';
import { authRoutes } from '../src/server/http/routes/auth.ts';
import { mobileRoutes } from '../src/server/http/routes/mobile.ts';
import { studioRoutes } from '../src/server/http/routes/studio.ts';
import { projectRunRoutes } from '../src/server/http/routes/project-run.ts';
import { connectionsRoutes } from '../src/server/http/routes/connections.ts';
import type { Ctx } from '../src/server/office/context.ts';
import type { Client } from '../src/server/office/client.ts';
import { setTunnelUrl } from '../src/server/phone-access/origin.ts';
import { raisesBudget, raisesTeamCap } from '../src/server/phone-access/risky.ts';
import { noteSocket, refuseStaleMsg, riskyMsg } from '../src/server/ws/reauth.ts';
import { defaultSettings } from '../src/server/roster/store.ts';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol.ts';
import { REAUTH_MS } from '../src/shared/mobile.ts';

const TUNNEL = 'x7abc-4600.euw.devtunnels.ms';

async function office() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ao-tunnel-reauth-'));
  const salt = randomBytes(16);
  const accounts = new Accounts(path.join(dir, 'data'));
  const cfg = { port: 0, trustProxy: false, dataDir: path.join(dir, 'data') };
  const ctx = {
    cfg,
    services: { lookup: () => undefined, list: () => [] },
    accounts,
    auth: new Auth(scryptSync('hunter2', salt, 32), salt, 'secret', accounts),
    floors: new Map(),
    meOf: () => ({ admin: true }),
  } as unknown as Ctx;
  const server = http.createServer(requestHandler(ctx, [authRoutes.login, mobileRoutes.reauth, studioRoutes.open, projectRunRoutes.act, connectionsRoutes.connections]));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  cfg.port = port;
  return { ctx, base: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** A session cookie issued `ago` ms back (the name the office gives its cookie, a token from then). */
async function cookieFrom(o: Awaited<ReturnType<typeof office>>, ago: number): Promise<string> {
  const r = await fetch(`${o.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'hunter2' }) });
  const name = (r.headers.get('set-cookie') ?? '').split('=')[0];
  const now = Date.now;
  Date.now = () => now() - ago;
  try {
    return `${name}=${o.ctx.auth.issue()}`;
  } finally {
    Date.now = now;
  }
}

const tunnelHeaders = (cookie: string) => ({ cookie, origin: `https://${TUNNEL}`, 'x-forwarded-host': TUNNEL, 'content-type': 'application/json' });
const localHeaders = (o: { base: string }, cookie: string) => ({ cookie, origin: o.base, 'content-type': 'application/json' });

test('through the tunnel a stale session is refused with 401 { reauth: true }; locally nothing changes', async () => {
  const o = await office();
  setTunnelUrl(`https://${TUNNEL}`);
  try {
    const old = await cookieFrom(o, REAUTH_MS + 60_000);
    const post = (p: string, headers: Record<string, string>, body: unknown) => fetch(`${o.base}${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
    // Studio open, pause, and a change in Connections: refused through the tunnel.
    for (const [p, body] of [
      ['/api/studio/open', { floor: 'nope' }],
      ['/api/project-run', { floor: 'nope', action: 'pause' }],
      ['/api/connections/sweep', { on: false }],
    ] as const) {
      const r = await post(p, tunnelHeaders(old), body);
      assert.equal(r.status, 401, p);
      assert.equal((await r.json()).reauth, true, p);
    }
    // Locally the same old cookie goes straight through (to "no such floor").
    assert.equal((await post('/api/studio/open', localHeaders(o, old), { floor: 'nope' })).status, 404);
    // What isn't risky isn't asked about through the tunnel either.
    assert.equal((await post('/api/project-run', tunnelHeaders(old), { floor: 'nope', action: 'cancel' })).status, 404);
    // The password typed again through the tunnel: the next ten minutes go through.
    assert.equal((await post('/api/m/reauth', tunnelHeaders(old), { password: 'hunter2' })).status, 200);
    assert.equal((await post('/api/studio/open', tunnelHeaders(old), { floor: 'nope' })).status, 404);
    // A session signed in just now is fresh by itself.
    const fresh = await cookieFrom(o, 0);
    assert.equal((await post('/api/project-run', tunnelHeaders(fresh), { floor: 'nope', action: 'pause' })).status, 404);
  } finally {
    setTunnelUrl(undefined);
    o.close();
  }
});

test('raising a team cap or a budget is risky; lowering one is not', () => {
  const s = { ...defaultSettings(), autonomy: 2 as const, costCaps: { 2: 20 } };
  assert.equal(raisesTeamCap(s, { costCaps: { 2: 30 } }), true);
  assert.equal(raisesTeamCap(s, { costCaps: {} }), true, 'taking the cap off');
  assert.equal(raisesTeamCap(s, { costCaps: { 2: 10 } }), false);
  assert.equal(raisesTeamCap(s, { idleMinutes: 30 }), false, 'other settings');
  assert.equal(raisesTeamCap({ ...s, costCaps: { 2: 20, 3: 50 } }, { autonomy: 3 }), true, 'a level whose cap is higher');
  const b = { total: 100, autoPause: true };
  assert.equal(raisesBudget({ action: 'settings', total: 150 }, b), true);
  assert.equal(raisesBudget({ action: 'settings', total: null }, b), true);
  assert.equal(raisesBudget({ action: 'settings', total: 80 }, b), false);
  assert.equal(raisesBudget({ action: 'settings', autoPause: false }, b), true);
  assert.equal(raisesBudget({ action: 'settings', total: 50 }, { autoPause: true }), false, 'a first budget only limits');
  for (const action of ['resume', 'level', 'firm']) assert.equal(raisesBudget({ action }, b), true, action);
  for (const action of ['plan', 'regenerate']) assert.equal(raisesBudget({ action }, b), false, action);
});

test('over a socket from the tunnel a merge or a hire waits for the password; locally it goes', () => {
  const cfg = {};
  const sent: ServerMsg[] = [];
  const floor = { workers: { deskOccupied: (d: string) => d === 'taken' } };
  const ctx = { cfg, floorOf: () => floor, sendTo: (_c: unknown, m: ServerMsg) => sent.push(m) } as unknown as Ctx;
  const req = (host: string) => ({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:4600', 'x-forwarded-host': host, cookie: '' } }) as unknown as http.IncomingMessage;
  setTunnelUrl(`https://${TUNNEL}`);
  try {
    const viaWs = {};
    const localWs = {};
    noteSocket(viaWs, req(TUNNEL));
    noteSocket(localWs, req('127.0.0.1:4600'));
    const merge: ClientMsg = { t: 'gh.merge', number: 7, method: 'squash', deleteBranch: true };
    const c = (ws: object) => ({ ws }) as unknown as Client;
    assert.equal(refuseStaleMsg(ctx, c(viaWs), merge), true);
    assert.deepEqual(sent, [{ t: 'reauth', retry: merge }]);
    assert.equal(refuseStaleMsg(ctx, c(localWs), merge), false);
    assert.equal(refuseStaleMsg(ctx, c(viaWs), { t: 'gh.refresh' }), false, 'not risky');
    assert.equal(riskyMsg(ctx, c(viaWs), { t: 'worker.spawn', deskId: 'd1' }), true);
    assert.equal(riskyMsg(ctx, c(viaWs), { t: 'station.prompt', deskId: 'free', prompt: 'hi' }), true, 'asking an empty station hires it');
    assert.equal(riskyMsg(ctx, c(viaWs), { t: 'station.prompt', deskId: 'taken', prompt: 'hi' }), false);
  } finally {
    setTunnelUrl(undefined);
  }
});

test('the page: a refusal asks for the password and sends again; cancelled, the merge window hears so', async () => {
  const { onReauthMsg, wantsReauth } = await import('../src/client/ui/reauth.ts');
  const { mergeWaiters } = await import('../src/client/ui/github/api.ts');
  assert.equal(await wantsReauth(new Response(JSON.stringify({ reauth: true }), { status: 401 })), true);
  assert.equal(await wantsReauth(new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401 })), false);
  assert.equal(await wantsReauth(new Response('{}', { status: 200 })), false);
  const sent: ClientMsg[] = [];
  const merge: ClientMsg = { t: 'gh.merge', number: 9, method: 'squash', deleteBranch: false };
  await onReauthMsg({ send: (m) => sent.push(m) }, merge, async () => true);
  assert.deepEqual(sent, [merge]);
  let heard: string | undefined;
  mergeWaiters.set(9, (m) => (heard = m.error));
  await onReauthMsg({ send: (m) => sent.push(m) }, merge, async () => false);
  assert.equal(sent.length, 1);
  assert.match(heard ?? '', /password/);
});
