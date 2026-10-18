// The live app's Console and Open live app on the page (src/client/ui/liveapp/console*.ts, open.ts), and
// the desktop app's Live app window rule (desktop/src/core/liveapp.ts). In headless Chromium, with every
// client stylesheet: the runtime log's rows (a client error marked, Debug off by default, a stack trace
// folded until opened), the level filters and search, Pause, Clear; the Network's rows (xas named by
// action, a failed request marked), Errors, a row opened to its headers and laid-out JSON; the badges; the
// stream asked for only while showing; Open live app pointing at the proxy in a named window without an
// opener. LIVEAPP_CONSOLE_SHOTS=<dir> also saves screenshots of both tabs there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { LogParser, type LiveNetEntry } from '../src/shared/liveapp/console.js';
import { IdList, logShows, freshLogFilter, netShows, freshNetFilter, pretty } from '../src/client/ui/liveapp/console-model.js';
import { liveWindowRequest, onOrigin } from '../desktop/src/core/liveapp.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const LOG = `=== runtime start 2026-10-18T09:00:00+08:00 ===
[rtlauncher:container$] INFO Container start took 2310. Ready to accept admin requests.
2026-10-18 09:00:03.475 INFO - M2EE: Initializing runtime...
2026-10-18 09:00:05.035 INFO - Core: Using runtime version '11.12.4' for model version '11.12.4'
2026-10-18 09:00:05.100 DEBUG - ConnectionBus: Opening pool
2026-10-18 09:00:22.710 WARNING - Core: MxAdmin user with username 'MxAdmin' does not exist!
2026-10-18 09:04:50.383 ERROR - Client: An error occurred while loading page 'Orders.Order_Overview'. This likely means that the page includes a broken widget.
SecurityError: Failed to read a named property 'com.mendix.widgets.web.sortable.sortContext' from 'Window': Blocked a frame from accessing a cross-origin frame.
    at http://localhost:8110/dist/chunks/a1b2c3.js:7:13640
2026-10-18 09:05:10.001 ERROR - ConnectionBus: Error executing query
com.mendix.connectionbus.ConnectionBusRuntimeException: An exception has occurred for the following request(s):
\tat com.mendix.connectionbus.RequestAnalyzer.doRequest(RequestAnalyzer.scala:45)
Caused by: org.postgresql.util.PSQLException: ERROR: relation "orders$order" does not exist
\tat org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2733)
2026-10-18 09:05:12.500 INFO - Core: Order list refreshed
`;

const entries = (() => {
  const r = new LogParser().push(LOG);
  return [...r.entries, ...(r.open ? [r.open] : [])];
})();

const at = Date.parse('2026-10-18T09:05:00Z');
const NET: LiveNetEntry[] = [
  { id: 1, at, method: 'GET', path: '/', kind: 'doc', status: 200, ms: 12, size: 1840, type: 'text/html', reqHeaders: [['accept', 'text/html'], ['cookie', 'XASSESSIONID=[redacted]']], resHeaders: [['content-type', 'text/html']], resNote: 'text/html · not recorded (only the app’s calls and errors are)' },
  { id: 2, at: at + 40, method: 'GET', path: '/dist/index.js?v=11', kind: 'asset', status: 200, ms: 31, size: 412_000, type: 'text/javascript', reqHeaders: [] },
  { id: 3, at: at + 90, method: 'POST', path: '/xas/', kind: 'xas', action: 'get_session_data', status: 200, ms: 48, size: 5120, type: 'application/json', reqHeaders: [['content-type', 'application/json'], ['x-csrf-token', '[redacted]']], reqBody: '{"action":"get_session_data","params":{"timezoneoffset":-480}}', resHeaders: [['content-type', 'application/json']], resBody: '{"user":{"guid":"123","name":"demo"},"roles":["User"]}' },
  { id: 4, at: at + 300, method: 'POST', path: '/xas/', kind: 'xas', action: 'retrieve_by_xpath Orders.Order', status: 560, ms: 97, size: 310, type: 'application/json', reqHeaders: [['content-type', 'application/json']], reqBody: '{"action":"retrieve_by_xpath","params":{"xpath":"//Orders.Order"}}', resHeaders: [['content-type', 'application/json']], resBody: '{"error":"An error has occurred while handling the request."}' },
  { id: 5, at: at + 320, method: 'GET', path: '/rest/orders/v1/orders', kind: 'xhr', ms: 5, reqHeaders: [], pending: true },
];

test('the model: lists by id (replace, insert in order, cap), filters, JSON laid out', () => {
  const l = new IdList<{ id: number; v: string }>(3);
  l.put([{ id: 1, v: 'a' }, { id: 3, v: 'c' }]);
  l.put([{ id: 2, v: 'b' }]);
  assert.deepEqual(l.items.map((e) => e.id), [1, 2, 3]);
  const r = l.put([{ id: 3, v: 'c2' }, { id: 4, v: 'd' }]);
  assert.deepEqual([r.replaced.length, r.added.length, r.dropped.map((e) => e.id)], [1, 1, [1]]);
  assert.equal(l.items[l.find(3)].v, 'c2');
  const f = freshLogFilter();
  assert.equal(entries.filter((e) => logShows(e, f)).length, entries.length - 1, 'Debug is off by default');
  assert.equal(entries.filter((e) => logShows(e, { ...f, text: 'psql' })).length, 1, 'search reaches the stack trace');
  assert.deepEqual(NET.filter((e) => netShows(e, { ...freshNetFilter(), view: 'xhr' })).map((e) => e.id), [3, 4, 5]);
  assert.deepEqual(NET.filter((e) => netShows(e, { ...freshNetFilter(), view: 'errors' })).map((e) => e.id), [4]);
  assert.equal(pretty('{"a":1}'), '{\n  "a": 1\n}');
  assert.equal(pretty('{"a":'), '{"a":', 'cut-short JSON as it came');
});

test('the desktop app: which links open a Live app window, and that window keeps to its origin', () => {
  assert.deepEqual(liveWindowRequest('http://localhost:8150/', 'mxoffice-liveapp-demo', 4600), { key: 'mxoffice-liveapp-demo', url: 'http://localhost:8150/', origin: 'http://localhost:8150' });
  assert.equal(liveWindowRequest('http://localhost:8150/', '_blank', 4600), undefined, 'only the office’s window name');
  assert.equal(liveWindowRequest('http://localhost:4600/', 'mxoffice-liveapp-demo', 4600), undefined, 'never the office itself');
  assert.equal(liveWindowRequest('http://example.com:8150/', 'mxoffice-liveapp-demo', 4600), undefined, 'only this machine');
  assert.equal(liveWindowRequest('https://localhost:8150/', 'mxoffice-liveapp-demo', 4600), undefined);
  assert.equal(liveWindowRequest('file:///c:/x', 'mxoffice-liveapp-demo', 4600), undefined);
  assert.ok(onOrigin('http://localhost:8150/p/orders', 'http://localhost:8150'));
  assert.ok(!onOrigin('http://localhost:8151/', 'http://localhost:8150'));
  const main = read('desktop/src/main.ts');
  assert.match(main, /liveWindowRequest\(url, frameName, opts\.port\)/);
  const win = read('desktop/src/liveapp.ts');
  assert.match(win, /partition: LIVE_PARTITION/, 'a session of its own: none of the office’s cookies');
  assert.match(win, /sandbox: true/);
});

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const chrome = findChrome();
test('in a browser: the Console’s log and network, filters, folding, badges, the stream only while showing; Open live app through the proxy', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { liveConsole } from './console';
        import { openPanel, liveUrl, liveWindowName } from './open';
        const sent = [];
        const net = { send: (m) => sent.push(m) };
        const con = liveConsole(net);
        const open = openPanel();
        const host = document.getElementById('host');
        host.append(open.el, con.el);
        window.T = { con, open, sent, liveUrl, liveWindowName };`,
      resolveDir: path.join(root, 'src/client/ui/liveapp'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  // The office page's stylesheets (the sign-in page's and the phone page's are other pages, with rules of their own for bare buttons).
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\\/]mobile[\\/]|[\\/]first-run[\\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const shots = process.env.LIVEAPP_CONSOLE_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><main class="lite-main" style="padding:16px"><div id="liveapp-view" class="la"><div id="host" style="display:flex;flex-direction:column;gap:10px"></div></div></main></body></html>`);
      await page.addScriptTag({ content: out.outputFiles[0].text });
      const T = (js: string) => page.evaluate(js);

      // Open live app: through the proxy, in the project's named window, no opener.
      const link = await T(`(() => { const s = { appPort: 8110, viewPort: 8150 }; const u = T.liveUrl(s, 'localhost'); T.open.show(u, 'demo', true); const a = document.querySelector('.la-go'); return { href: a.href, target: a.target, rel: a.rel, direct: T.liveUrl({ appPort: 8110 }, 'localhost'), name: T.liveWindowName('demo') }; })()`);
      assert.deepEqual(link, { href: 'http://localhost:8150/', target: 'mxoffice-liveapp-demo', rel: 'noopener', direct: 'http://localhost:8110/', name: 'mxoffice-liveapp-demo' });

      // The stream: asked for while showing, let go when the browser tab hides.
      await T(`T.con.setShown(true)`);
      assert.deepEqual(await T(`T.sent`), [{ t: 'liveapp.console', on: true }]);
      await T(`T.con.setShown(true)`);
      assert.equal(((await T(`T.sent`)) as unknown[]).length, 1, 'said once');
      await T(`T.con.setShown(false)`);
      assert.deepEqual(((await T(`T.sent`)) as unknown[]).at(-1), { t: 'liveapp.console', on: false });
      await T(`T.con.setShown(true)`);

      // The log.
      await page.evaluate(([log, net]) => (window as any).T.con.route({ t: 'liveapp.console', floor: 'demo', reset: true, log, net }, 'demo'), [entries, NET] as const);
      await T(`T.con.setRecording('http://localhost:8150/')`);
      const log = (await T(`(() => {
        const rows = [...document.querySelectorAll('.lc-log .lc-row')];
        return { rows: rows.length, client: rows.filter((r) => r.classList.contains('lc-client')).length, debug: rows.filter((r) => r.classList.contains('lc-debug')).length, details: document.querySelectorAll('.lc-detail').length, badge: document.querySelector('#lc-tab-log .lc-badge').textContent, badgeHidden: document.querySelector('#lc-tab-log .lc-badge').hidden, err: document.querySelector('.lc-seg[data-level=error]').textContent };
      })()`)) as Record<string, unknown>;
      assert.deepEqual(log, { rows: entries.length - 1, client: 1, debug: 0, details: 0, badge: '2', badgeHidden: false, err: 'Error 2' });
      // Fold open the client error, then the query error.
      await page.click('.lc-client .lc-caret');
      await page.click('.lc-row.lc-error:not(.lc-client) .lc-caret');
      const opened = (await T(`[...document.querySelectorAll('.lc-detail')].map((d) => d.textContent.split('\\n')[0])`)) as string[];
      assert.equal(opened.length, 2);
      assert.match(opened[0], /^SecurityError/);
      assert.equal(await T(`document.querySelector('.lc-client .lc-caret').getAttribute('aria-expanded')`), 'true');
      if (shots) await page.screenshot({ path: path.join(shots, `console-log-${theme}.png`), fullPage: true });
      // Filters: errors only; search; Debug on.
      await page.click('.lc-seg[data-level=info]');
      await page.click('.lc-seg[data-level=warning]');
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), 2);
      await page.click('.lc-seg[data-level=info]');
      await page.click('.lc-seg[data-level=warning]');
      await page.fill('.lc-log .lc-search', 'relation');
      await page.waitForTimeout(250);
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), 1, 'search reaches the stack trace');
      await page.fill('.lc-log .lc-search', '');
      await page.click('.lc-seg[data-level=debug]');
      await page.waitForTimeout(250);
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), entries.length);
      // Pause holds news back; Resume shows it; Clear empties the view only.
      await page.click('.lc-log .lc-btn:has-text("Pause")');
      const more = { id: 999, time: '2026-10-18 09:06:00.000', level: 'error', node: 'Client', message: 'Another widget failed', client: true };
      await page.evaluate((e) => (window as any).T.con.route({ t: 'liveapp.console', floor: 'demo', log: [e] }, 'demo'), more);
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), entries.length, 'held back');
      assert.match((await T(`document.querySelector('.lc-log .lc-btn[aria-pressed=true]').textContent`)) as string, /Resume \(1 new\)/);
      await page.click('.lc-log .lc-btn:has-text("Resume")');
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), entries.length + 1);
      await page.evaluate(() => (window as any).T.con.route({ t: 'liveapp.console', floor: 'other', log: [{ id: 1000, time: '', level: 'error', node: 'x', message: 'another floor' }] }, 'demo'));
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), entries.length + 1, 'another floor’s news is not ours');

      // The network.
      await page.click('#lc-tab-net');
      const net = (await T(`(() => {
        const items = [...document.querySelectorAll('.ln-item')];
        return { items: items.length, names: items.map((i) => i.querySelector('.ln-name').firstChild.textContent), failed: items.filter((i) => i.classList.contains('ln-failed')).length, pending: items.filter((i) => i.classList.contains('ln-pending')).length, badge: document.querySelector('#lc-tab-net .lc-badge').textContent, logHidden: document.getElementById('lc-panel-log').hidden };
      })()`)) as Record<string, unknown>;
      assert.deepEqual(net, { items: 5, names: ['/', 'index.js', 'xas · get_session_data', 'xas · retrieve_by_xpath Orders.Order', 'orders'], failed: 1, pending: 1, badge: '1', logHidden: true });
      await page.click('.ln-item[data-id="3"] .ln-line');
      const detail = (await T(`(() => { const d = document.querySelector('.ln-item[data-id="3"] .ln-detail'); return { text: d.textContent, bodies: [...d.querySelectorAll('.ln-body')].map((b) => b.textContent) }; })()`)) as { text: string; bodies: string[] };
      assert.match(detail.text, /Addresshttp:\/\/localhost:8150\/xas\//);
      assert.match(detail.text, /x-csrf-token\[redacted\]/);
      assert.equal(detail.bodies[1], JSON.stringify({ user: { guid: '123', name: 'demo' }, roles: ['User'] }, null, 2), 'JSON laid out');
      await page.click('.ln-item[data-id="4"] .ln-line');
      await T(`document.querySelector('.ln-item[data-id="3"]').scrollIntoView({ block: 'start' })`);
      if (shots) await page.screenshot({ path: path.join(shots, `console-network-${theme}.png`), fullPage: true });
      await page.click('.lc-net .lc-seg[data-view=errors]');
      assert.equal(await T(`document.querySelectorAll('.ln-item').length`), 1);
      await page.click('.lc-net .lc-seg[data-view=xhr]');
      assert.equal(await T(`document.querySelectorAll('.ln-item').length`), 3);
      // The pending one ends: replaced in place.
      await page.evaluate((e) => (window as any).T.con.route({ t: 'liveapp.console', floor: 'demo', net: [e] }, 'demo'), { ...NET[4], pending: undefined, status: 200, ms: 40, size: 900 });
      assert.equal(await T(`document.querySelector('.ln-item[data-id="5"] .ln-status').textContent`), '200');
      await page.click('.lc-net .lc-btn:has-text("Clear")');
      assert.equal(await T(`document.querySelectorAll('.ln-item').length`), 0);
      assert.equal(await T(`document.querySelector('#lc-tab-net .lc-badge').hidden`), true, 'cleared: no failures counted');
      // A reconnect starts over and asks again.
      const before = ((await T(`T.sent`)) as unknown[]).length;
      await T(`T.con.route({ t: 'welcome' }, 'demo')`);
      assert.equal(await T(`document.querySelectorAll('.lc-log .lc-row').length`), 0);
      assert.deepEqual(((await T(`T.sent`)) as unknown[]).slice(before), [{ t: 'liveapp.console', on: true }]);
      assert.deepEqual(errors, []);
      // Phone width: no sideways scroll.
      await page.setViewportSize({ width: 390, height: 800 });
      assert.ok(((await T(`document.documentElement.scrollWidth`)) as number) <= 390, 'no horizontal scroll at 390 px');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
