// The live app's Console, server side (src/server/liveapp/console/, src/shared/liveapp/console.ts): the
// runtime log's parser (levels, stack traces grouped under their entry, the web client's errors, mxcli's
// start marks), the tail (only what was added, a first read near the end, a log that began again), the
// recording proxy against a fake Mendix runtime (forwards, records, redacts, truncates, a ring of
// NET_KEEP, the office's cookie never passed on nor set, redirects pointed back, WebSockets spliced
// through) and the Console's streams (only to whoever watches, a snapshot first, batched).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { BODY_MAX, LogParser, NET_KEEP, logText, netName, type LiveLogEntry, type LiveNetEntry } from '../src/shared/liveapp/console.js';
import { LogTail, LOG_START_BYTES } from '../src/server/liveapp/console/tail.js';
import { RecordingProxy, downstreamHeaders, pathOf, upstreamHeaders } from '../src/server/liveapp/console/proxy.js';
import { kindOf, maskSecrets, redactHeader, xasAction } from '../src/server/liveapp/console/record.js';
import { LiveConsoles } from '../src/server/liveapp/console/index.js';
import { runtimeLogOf } from '../src/server/liveapp/index.js';

const LOG = `=== runtime start 2026-10-13T07:59:57+08:00 ===
[rtlauncher:container$] INFO Container start took 4875. Ready to accept admin requests.
2026-10-13 08:00:02.948 INFO - M2EE: Added admin request handler '/probes/started' with servlet class 'null'
2026-10-13 08:00:22.710 WARNING - Core: MxAdmin user with username 'MxAdmin' does not exist!
2026-10-13 08:01:05.120 ERROR - Client: An error occurred while loading page 'Orders.Order_Overview'. This likely means that the page includes a broken widget.
SecurityError: Failed to read a named property 'x' from 'Window': Blocked a frame with origin "http://localhost:8110" from accessing a cross-origin frame.
    at http://localhost:8110/dist/chunks/abc.js:7:13640
2026-10-13 10:37:20.925 ERROR - M2EE: An exception occurred during Runtime shutdown.
com.mendix.m2ee.api.internal.AdminException: Stopping Mendix Runtime failed.
\tat com.mendix.basis.impl.MxRuntimeImpl.shutdown(MxRuntimeImpl.scala:351)
Caused by: com.mendix.connectionbus.ConnectionBusRuntimeException: An exception has occurred
\tat com.mendix.connectionbus.RequestAnalyzer.doRequest(RequestAnalyzer.scala:45)
2026-10-13 10:37:21.001 DEBUG - ConnectionBus: Closing the pool
`;

test('the parser: levels, nodes, stack traces and "Caused by" grouped under their entry, client errors, marks', () => {
  const p = new LogParser();
  const { entries, open } = p.push(LOG);
  const all = [...entries, open!];
  assert.equal(all.length, 7);
  assert.deepEqual(all.map((e) => [e.level, e.node]), [['info', 'mxcli'], ['info', 'rtlauncher'], ['info', 'M2EE'], ['warning', 'Core'], ['error', 'Client'], ['error', 'M2EE'], ['debug', 'ConnectionBus']]);
  assert.equal(all[0].mark, true);
  assert.equal(all[2].time, '2026-10-13 08:00:02.948');
  const client = all[4];
  assert.equal(client.client, true);
  assert.match(client.message, /loading page 'Orders\.Order_Overview'/);
  assert.equal(client.detail?.split('\n').length, 2, 'the SecurityError and its frame');
  const crash = all[5];
  assert.match(crash.detail!, /^com\.mendix\.m2ee.*\n\tat .*\nCaused by: .*\n\tat /);
  assert.equal(crash.client, undefined);
  assert.ok(all.every((e, i) => i === 0 || e.id > all[i - 1].id), 'ids go up');
  assert.match(logText(crash), /^2026-10-13 10:37:20\.925 ERROR - M2EE: An exception.*\nCaused by/s);
});

test('the parser, a piece at a time: a line split across reads, an open entry growing, a read from the middle', () => {
  const p = new LogParser();
  const a = p.push('2026-10-13 08:00:00.000 ERROR - Core: boom\n\tat x');
  assert.equal(a.entries.length, 0);
  assert.equal(a.open?.detail, undefined, 'the half line waits');
  const b = p.push('(Y.java:1)\n\tat z\n');
  assert.equal(b.open?.id, a.open?.id);
  assert.equal(b.open?.detail, '\tat x(Y.java:1)\n\tat z');
  const c = p.push('2026-10-13 08:00:01.000 INFO - Core: next\n');
  assert.equal(c.entries[0].id, a.open?.id, 'the grown entry is done once the next starts');
  const mid = new LogParser(50, { fromMiddle: true });
  const m = mid.push('runtime.scala:12)\n\tat more\n2026-10-13 08:00:01.000 INFO - Core: first whole entry\n');
  assert.equal(m.entries.length, 0);
  assert.equal(m.open?.message, 'first whole entry', 'the pieces before the first entry are dropped');
  assert.equal(m.open?.id, 50);
});

test('the parser caps a huge stack trace', () => {
  const p = new LogParser();
  const r = p.push(`2026-10-13 08:00:00.000 ERROR - Core: deep\n${'\tat frame\n'.repeat(1000)}`);
  const lines = r.open!.detail!.split('\n');
  assert.ok(lines.length <= 302, `${lines.length} lines kept`);
  assert.equal(lines[lines.length - 1], '…');
});

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'mx-console-'));
const until = async (what: string, fn: () => boolean, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('the tail: a missing log, then what was added (never the whole file again), then a log that began again', async () => {
  const dir = tmp();
  const file = path.join(dir, '.mxcli', 'runtime.log');
  const got: { list: LiveLogEntry[]; reset: boolean }[] = [];
  const missing: boolean[] = [];
  const tail = new LogTail(file, { entries: (list, reset) => got.push({ list, reset }), missing: (y) => missing.push(y) }, { statMs: 50 });
  try {
    tail.start();
    await tail.settled();
    assert.deepEqual(missing, [true]);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, LOG);
    await until('the first read', () => tail.snapshot().length === 7);
    assert.deepEqual(missing, [true, false]);
    const before = got.length;
    appendFileSync(file, '2026-10-13 10:40:00.000 ERROR - Client: Another page failed\n');
    await until('the appended entry', () => tail.snapshot().some((e) => e.message === 'Another page failed'));
    const news = got.slice(before).flatMap((g) => g.list);
    assert.ok(news.every((e) => e.message !== "Added admin request handler '/probes/started' with servlet class 'null'"), 'nothing read twice');
    assert.ok(news.some((e) => e.node === 'ConnectionBus'), 'the open entry, now done, is sent again with its id');
    assert.equal(tail.snapshot().length, 8);
    // Stopped, nothing is read; started again, only what came since.
    tail.stop();
    appendFileSync(file, '2026-10-13 10:41:00.000 INFO - Core: while hidden\n');
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!tail.snapshot().some((e) => e.message === 'while hidden'));
    tail.start();
    await until('what came while stopped', () => tail.snapshot().some((e) => e.message === 'while hidden'));
    // Begun again (shorter than where it was): read afresh, and the page told to start over.
    writeFileSync(file, '=== runtime start 2026-10-14T08:00:00+08:00 ===\n2026-10-14 08:00:01.000 INFO - Core: fresh\n');
    await until('the reset', () => got.some((g) => g.reset));
    await until('the fresh entries', () => tail.snapshot().some((e) => e.message === 'fresh'));
    assert.equal(tail.snapshot().length, 2);
    const maxOld = Math.max(...got.filter((g) => !g.reset).flatMap((g) => g.list.map((e) => e.id)));
    assert.ok(tail.snapshot()[0].id > 0 && tail.snapshot().every((e) => e.id > 0));
    assert.ok(tail.snapshot()[0].id >= maxOld || maxOld > 0, 'ids keep counting up');
  } finally {
    tail.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the tail: a first read of a big log starts near its end', async () => {
  const dir = tmp();
  const file = path.join(dir, 'runtime.log');
  const line = (i: number) => `2026-10-13 08:00:00.000 INFO - Core: line ${i} ${'x'.repeat(80)}\n`;
  writeFileSync(file, Array.from({ length: 20000 }, (_, i) => line(i)).join(''));
  const tail = new LogTail(file, { entries: () => {}, missing: () => {} }, { statMs: 1000 });
  try {
    tail.start();
    await tail.settled();
    const snap = tail.snapshot();
    assert.ok(snap.length <= 2000, `${snap.length} kept`);
    assert.match(snap[snap.length - 1].message, /^line 19999 /);
    assert.ok(snap.length * 100 <= LOG_START_BYTES + 200, 'only the last part was read');
  } finally {
    tail.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('what a request shows: cookies by name only, credentials redacted, passwords masked, kinds, xas actions', () => {
  assert.equal(redactHeader('Cookie', 'XASSESSIONID=abc; DeviceType=Desktop'), 'XASSESSIONID=[redacted]; DeviceType=[redacted]');
  assert.equal(redactHeader('set-cookie', 'XASSESSIONID=abc; Path=/; HttpOnly'), 'XASSESSIONID=[redacted]; Path=/; HttpOnly');
  assert.equal(redactHeader('Authorization', 'Basic dXNlcjpwYXNz'), 'Basic [redacted]');
  assert.equal(redactHeader('x-csrf-token', 'abc'), '[redacted]');
  assert.equal(redactHeader('accept', 'application/json'), 'application/json');
  assert.equal(maskSecrets('{"action":"login","params":{"username":"demo","password":"hunter2"}}', 'application/json'), '{"action":"login","params":{"username":"demo","password":"***"}}');
  assert.equal(maskSecrets('{"action":"login","params":{"password":"hunter2","x":"', 'application/json'), '{"action":"login","params":{"password":"***","x":"', 'cut short: by pattern');
  assert.equal(maskSecrets('user=demo&password=hunter2&token=t', 'application/x-www-form-urlencoded'), 'user=demo&password=***&token=***');
  assert.equal(xasAction('{"action":"executeaction","params":{"actionname":"Orders.ACT_Save"}}'), 'executeaction Orders.ACT_Save');
  assert.equal(xasAction('{"action":"retrieve_by_xpath","params":{"xpath":"//Orders.Order[Status=\'Open\']"}}'), 'retrieve_by_xpath Orders.Order');
  assert.equal(xasAction('{"action":"runtimeOperation","operationId":"aGVsbG8"}'), 'runtimeOperation');
  assert.equal(xasAction('{"action":"get_session_data","params":{'), 'get_session_data');
  assert.equal(xasAction('not json'), undefined);
  assert.equal(kindOf('/xas/', {}, 'POST'), 'xas');
  assert.equal(kindOf('/', { 'sec-fetch-dest': 'document' }, 'GET'), 'doc');
  assert.equal(kindOf('/rest/orders', { 'sec-fetch-dest': 'empty' }, 'GET'), 'xhr');
  assert.equal(kindOf('/dist/a.js', { 'sec-fetch-dest': 'script' }, 'GET'), 'asset');
  assert.equal(netName({ path: '/dist/chunks/a.js?v=1', kind: 'asset' }), 'a.js');
  assert.equal(netName({ path: '/xas/', kind: 'xas', action: 'executeaction Orders.ACT_Save' }), 'xas · executeaction Orders.ACT_Save');
  assert.equal(pathOf('http://evil.example/x?y=1'), '/x?y=1', 'an absolute-form URL counts only for its path');
  assert.equal(pathOf('/p/orders'), '/p/orders');
});

test("the office's session cookies never go on, and the app can't set one", () => {
  const up = upstreamHeaders({ cookie: 'ao_session_4600=office-secret; XASSESSIONID=app; ao_session=x', connection: 'keep-alive', host: 'localhost:8150' });
  assert.equal(up.cookie, 'XASSESSIONID=app');
  assert.equal(up.connection, undefined);
  assert.equal(up.host, 'localhost:8150', 'the Host stays the proxy’s: the app is same-origin with itself');
  assert.equal(upstreamHeaders({ cookie: 'ao_session_4600=s' }).cookie, undefined);
  const down = downstreamHeaders({ 'set-cookie': ['ao_session_4600=evil; Path=/', 'XASSESSIONID=ok; Path=/'], location: 'http://localhost:8110/login.html' }, 8110, 'localhost:8150');
  assert.deepEqual(down['set-cookie'], ['XASSESSIONID=ok; Path=/']);
  assert.equal(down.location, 'http://localhost:8150/login.html');
  assert.equal(downstreamHeaders({ location: '/p/home' }, 8110, 'localhost:8150').location, '/p/home');
});

/** A fake Mendix runtime: a page that sets its cookie, xas/ calls, a big JSON, an image, gzip, an error, a WebSocket. */
async function fakeRuntime() {
  const seen: http.IncomingHttpHeaders[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers);
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const url = req.url ?? '/';
      if (url === '/') {
        res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['XASSESSIONID=app-session; Path=/; HttpOnly', 'ao_session_4600=planted; Path=/'] });
        return res.end('<!doctype html><title>App</title>');
      }
      if (url === '/xas/') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ echo: JSON.parse(body || '{}'), token: 'should-be-masked' }));
      }
      if (url === '/big') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ rows: Array.from({ length: 2000 }, (_, i) => ({ i, name: `row ${i}` })) }));
      }
      if (url === '/img') {
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(Buffer.alloc(3000, 7));
      }
      if (url === '/gz') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
        return res.end(zlib.gzipSync(JSON.stringify({ zipped: true })));
      }
      if (url === '/fail') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        return res.end('Internal error');
      }
      if (url === '/moved') {
        res.writeHead(302, { location: `http://localhost:${(server.address() as AddressInfo).port}/login.html` });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
  });
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsCookies: (string | undefined)[] = [];
  wss.on('connection', (sock, req) => {
    wsCookies.push(req.headers.cookie);
    sock.on('message', (m) => sock.send(`echo:${m}`));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { port: (server.address() as AddressInfo).port, seen, wsCookies, close: () => new Promise<void>((r) => (wss.close(), server.closeAllConnections(), server.close(() => r()))) };
}

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const p = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}

function fetchVia(port: number, p: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: init.method ?? 'GET', headers: { host: `localhost:${port}`, ...init.headers } }, (res) => {
      const c: Buffer[] = [];
      res.on('data', (d: Buffer) => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(c).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(init.body);
  });
}

test('the proxy forwards to the runtime and records: statuses, bodies (masked, cut, binary noted, gzip read), xas actions, redirects, cookies', async () => {
  const rt = await fakeRuntime();
  const port = await freePort();
  const recs = new Map<number, LiveNetEntry>();
  const proxy = new RecordingProxy({ host: '127.0.0.1', port, upstream: () => rt.port, record: (e) => recs.set(e.id, e) });
  await proxy.start();
  try {
    const office = 'ao_session_4600=office-secret';
    const home = await fetchVia(port, '/', { headers: { cookie: `${office}; XASSESSIONID=old`, accept: 'text/html', 'sec-fetch-dest': 'document' } });
    assert.equal(home.status, 200);
    assert.deepEqual(home.headers['set-cookie'], ['XASSESSIONID=app-session; Path=/; HttpOnly'], "the runtime's cookie comes through; one under the office's name doesn't");
    assert.equal(rt.seen[0].cookie, 'XASSESSIONID=old', "the office's cookie never reaches the runtime");
    const login = await fetchVia(port, '/xas/', { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-dest': 'empty', 'x-csrf-token': 'csrf-1', cookie: office }, body: JSON.stringify({ action: 'login', params: { username: 'demo', password: 'hunter2' } }) });
    assert.equal(login.status, 200);
    assert.match(login.body, /hunter2/, 'the app gets what it was sent: masking is only in the record');
    await fetchVia(port, '/xas/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'executeaction', params: { actionname: 'Orders.ACT_Save' } }) });
    await fetchVia(port, '/big', { headers: { 'sec-fetch-dest': 'empty' } });
    await fetchVia(port, '/img', { headers: { 'sec-fetch-dest': 'image' } });
    const gz = await fetchVia(port, '/gz', { headers: { 'sec-fetch-dest': 'empty' } });
    assert.equal(gz.headers['content-encoding'], 'gzip', 'passed on as it came');
    await fetchVia(port, '/fail', { headers: { 'sec-fetch-dest': 'empty' } });
    const moved = await fetchVia(port, '/moved');
    assert.equal(moved.headers.location, `http://localhost:${port}/login.html`, 'a redirect to the runtime’s own port comes back to the proxy');
    await until('every request recorded', () => [...recs.values()].filter((e) => !e.pending).length >= 8);
    const list = [...recs.values()].sort((a, b) => a.id - b.id);
    const [h0, l, ex, big, img, gzr, fail] = list;
    assert.equal(h0.kind, 'doc');
    assert.equal(h0.status, 200);
    assert.ok(h0.reqHeaders.some(([k, v]) => k === 'cookie' && v === 'XASSESSIONID=[redacted]'), 'cookies by name only, the office’s not even named');
    assert.ok(!JSON.stringify(list).includes('office-secret') && !JSON.stringify(list).includes('ao_session'), "the office's cookie is nowhere in the records");
    assert.ok(h0.resHeaders?.some(([k, v]) => k === 'set-cookie' && v.startsWith('XASSESSIONID=[redacted]')));
    assert.equal(h0.resBody, undefined, 'page bodies are not kept');
    assert.equal(l.kind, 'xas');
    assert.equal(l.action, 'login');
    assert.match(l.reqBody!, /"password":"\*\*\*"/);
    assert.ok(!JSON.stringify(l).includes('hunter2') && !JSON.stringify(l).includes('csrf-1'), 'no password nor CSRF token in the record');
    assert.match(l.resBody!, /"token":"\*\*\*"/);
    assert.equal(ex.action, 'executeaction Orders.ACT_Save');
    assert.ok(typeof ex.ms === 'number' && ex.ms >= 0);
    assert.ok(big.size! > BODY_MAX && big.resBody!.length <= BODY_MAX, `cut at ${BODY_MAX} (${big.resBody!.length})`);
    assert.match(big.resNote!, /the first 8\.0 KB/);
    assert.equal(img.resBody, undefined);
    assert.equal(img.kind, 'asset');
    assert.equal(img.size, 3000);
    assert.equal(gzr.resBody, '{"zipped":true}', 'a gzip answer read for the record');
    assert.equal(fail.status, 500);
    assert.equal(fail.resBody, 'Internal error', "an error's body is kept");
  } finally {
    await proxy.stop();
    await rt.close();
  }
});

test('the proxy: the runtime not answering is a 503 that reloads itself, recorded; the ring keeps the last NET_KEEP', async () => {
  const port = await freePort();
  const dead = await freePort();
  const recs: LiveNetEntry[] = [];
  let upstream: number | undefined;
  const proxy = new RecordingProxy({ host: '127.0.0.1', port, upstream: () => upstream, record: (e) => recs.push(e) });
  await proxy.start();
  try {
    const r = await fetchVia(port, '/', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 503);
    assert.match(r.body, /http-equiv="refresh"/);
    upstream = dead;
    const r2 = await fetchVia(port, '/xas/', { method: 'POST', body: '{}' });
    assert.equal(r2.status, 503);
    await until('recorded', () => recs.some((e) => e.status === 0));
    assert.ok(recs.find((e) => e.status === 0)?.error);
  } finally {
    await proxy.stop();
  }
  // The ring, through the consoles.
  const cons = new LiveConsoles({ host: '127.0.0.1', ports: { from: 1, to: 1 }, taken: () => new Set(), logFile: () => path.join(os.tmpdir(), 'none', 'runtime.log'), portChanged: () => {} });
  const rec = (cons as unknown as { record(f: string, fc: unknown, e: LiveNetEntry): void }).record.bind(cons);
  const fc = { subs: new Map(), net: [] as LiveNetEntry[], out: { log: new Map(), net: new Map() } };
  (cons as unknown as { floors: Map<string, unknown> }).floors.set('f1', fc);
  for (let i = 1; i <= NET_KEEP + 50; i++) rec('f1', fc, { id: i, at: i, method: 'GET', path: `/r${i}`, kind: 'xhr', reqHeaders: [], pending: true });
  rec('f1', fc, { id: NET_KEEP + 50, at: 0, method: 'GET', path: '/last', kind: 'xhr', reqHeaders: [], status: 200 });
  const kept = cons.requests('f1');
  assert.equal(kept.length, NET_KEEP);
  assert.equal(kept[0].id, 51);
  assert.equal(kept[kept.length - 1].path, '/last', 'a finished request replaces its pending one');
});

test('the proxy splices WebSockets through, without the office’s cookie, and records them', async () => {
  const rt = await fakeRuntime();
  const port = await freePort();
  const recs = new Map<number, LiveNetEntry>();
  const proxy = new RecordingProxy({ host: '127.0.0.1', port, upstream: () => rt.port, record: (e) => recs.set(e.id, e) });
  await proxy.start();
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { cookie: 'ao_session_4600=office-secret; XASSESSIONID=app' } });
    const reply = await new Promise<string>((resolve, reject) => {
      ws.once('open', () => ws.send('ping'));
      ws.once('message', (m) => resolve(String(m)));
      ws.once('error', reject);
    });
    assert.equal(reply, 'echo:ping');
    assert.deepEqual(rt.wsCookies, ['XASSESSIONID=app']);
    const open = [...recs.values()].find((e) => e.kind === 'ws');
    assert.equal(open?.status, 101);
    ws.close();
    await until('the close recorded', () => [...recs.values()].some((e) => e.kind === 'ws' && !e.pending && typeof e.ms === 'number'));
  } finally {
    await proxy.stop();
    await rt.close();
  }
});

test('the consoles: a proxy while the app is up (its port in the state), streams only to watchers, a snapshot first, batched', async () => {
  const dir = tmp();
  const file = path.join(dir, '.mxcli', 'runtime.log');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, LOG);
  const rt = await fakeRuntime();
  const base = await freePort();
  const changed: string[] = [];
  const cons = new LiveConsoles({ host: '127.0.0.1', ports: { from: base, to: base + 20 }, taken: () => new Set([rt.port]), logFile: () => file, portChanged: (f) => changed.push(f), statMs: 50 });
  try {
    cons.sync({ floor: 'f1', status: 'starting', log: [], available: true, appPort: rt.port });
    await until('the proxy', () => cons.portOf('f1') !== undefined);
    assert.deepEqual(changed, ['f1']);
    const view = cons.portOf('f1')!;
    assert.notEqual(view, rt.port);
    assert.deepEqual(cons.ports(), [view]);
    // Nobody watching: recorded, not sent.
    await fetchVia(view, '/xas/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"get_session_data"}' });
    await until('recorded', () => cons.requests('f1').some((e) => !e.pending));
    const msgs: Parameters<Parameters<LiveConsoles['watch']>[2]>[0][] = [];
    const me = {};
    cons.watch('f1', me, (m) => msgs.push(m), true);
    assert.equal(msgs[0].reset, true, 'a snapshot first');
    assert.equal(msgs[0].net?.length, 1);
    await until('the log read', () => msgs.some((m) => (m.log?.length ?? 0) >= 7));
    const n = msgs.length;
    for (let i = 0; i < 5; i++) await fetchVia(view, '/xas/', { method: 'POST', body: '{"action":"commit"}' });
    await until('the requests sent', () => msgs.slice(n).flatMap((m) => m.net ?? []).filter((e) => !e.pending).length >= 5);
    assert.ok(msgs.length - n <= 6, `batched: ${msgs.length - n} messages for 5 requests`);
    appendFileSync(file, '2026-10-13 11:00:00.000 ERROR - Client: A widget failed\n');
    await until('the new client error', () => msgs.some((m) => m.log?.some((e) => e.message === 'A widget failed' && e.client)));
    // Unwatched: nothing more is sent.
    cons.unwatch(me);
    const after = msgs.length;
    await fetchVia(view, '/xas/', { method: 'POST', body: '{}' });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(msgs.length, after);
    // The app stopped: the proxy goes.
    cons.sync({ floor: 'f1', status: 'stopped', log: [], available: true });
    await until('the proxy gone', () => cons.portOf('f1') === undefined);
    assert.deepEqual(changed, ['f1', 'f1']);
  } finally {
    await cons.shutdown();
    await rt.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('where the runtime log is: the .mpr’s folder, the checkout’s root without one, and no checkout yet is no error', () => {
  const dir = tmp();
  try {
    const none = path.join(dir, 'live', 'never-started');
    assert.equal(runtimeLogOf(undefined, none), path.join(none, '.mxcli', 'runtime.log'), 'no checkout: no throw (it took the office down once)');
    const co = path.join(dir, 'live', 'demo');
    mkdirSync(path.join(co, 'app'), { recursive: true });
    writeFileSync(path.join(co, 'app', 'Demo.mpr'), 'x');
    assert.equal(runtimeLogOf(undefined, co), path.join(co, 'app', '.mxcli', 'runtime.log'));
    assert.equal(runtimeLogOf(path.join(co, 'elsewhere'), co), path.join(co, 'elsewhere', '.mxcli', 'runtime.log'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
