// Expert mode, slices 1 and 3, in a real, throwaway TEST office (fake agents only, test mode, no GitHub: GH
// tokens removed and an empty GH_CONFIG_DIR, no Claude). One neutral Expert-mode project ("Order Desk"): a git
// folder with an empty .mpr, a stand-in mxcli (node running the project's own `run` script, which serves a
// small orders page) so the live preview runs, and phases seeded by scripts/phased-delivery-fixture.ts. Checks,
// on the real 1D view:
//
//   - arriving on the project opens the Session screen; the team-lead panel isn't there; Session is listed
//   - the session starts by itself with no prompt (the fake agent's terminal), the header says its state
//   - the phase strip shows; the proof strip says "coming soon" (no proof module answers yet)
//   - the preview runs the app; the split resizes by keys and remembers it; App | Chat presets; swap
//   - Portal Light and Dark, the navigation folded, no sideways scrolling, no page errors
//
// and saves screenshots.
//
//   npm run build && node scripts/expert-shell-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'expert-shell')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'expert-shell', 'shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};

/** Stands in for `mxcli run`: builds, then serves a small orders page on --app-port (version.txt says which change). */
const FAKE_MXCLI = `const fs = require('fs');
const port = Number(process.argv[process.argv.indexOf('--app-port') + 1]);
console.log('Building the project…');
setTimeout(() => {
  console.log('Starting the Mendix runtime…');
  const rows = [['SO-1042','Northwind Supplies','3 pallets','Packed'],['SO-1041','Blue Harbor Foods','12 boxes','Waiting'],['SO-1039','Summit Tools','1 crate','Shipped'],['SO-1038','Lakeside Office','40 reams','Waiting'],['SO-1036','Green Valley Farm','6 drums','Shipped']];
  const page = () => '<!doctype html><meta charset=utf-8><title>Order Desk</title><style>body{margin:0;font:14px system-ui,sans-serif;color:#1f2937;background:#f8fafc}header{background:#1e293b;color:#fff;padding:12px 20px;display:flex;gap:18px;align-items:center}header b{font-size:15px}header span{opacity:.8}main{padding:20px}h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 16px}.cards{display:flex;gap:10px;margin-bottom:16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:10px 14px;min-width:90px}.card b{display:block;font-size:18px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #eef2f7}th{background:#f1f5f9;font-weight:600}.s{padding:2px 8px;border-radius:10px;font-size:12px;background:#e0f2fe}</style><header><b>Order Desk</b><span>Orders</span><span>Customers</span><span>Reports</span></header><main><h1>Orders</h1><p>Orders waiting to ship, newest first. (' + fs.readFileSync('version.txt','utf8').trim() + ')</p><div class=cards><div class=card>Waiting<b>2</b></div><div class=card>Packed<b>1</b></div><div class=card>Shipped<b>2</b></div></div><table><tr><th>Order</th><th>Customer</th><th>Goods</th><th>Status</th></tr>' + rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td><span class=s>' + r[3] + '</span></td></tr>').join('') + '</table></main>';
  require('http').createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(page()); }).listen(port, () => console.log('Runtime started'));
}, 800);`;

function fixture() {
  const home = path.join(root, 'office');
  const data = path.join(home, '.agent-office');
  const dir = path.join(root, 'projects', 'order-desk');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'README.md'), '# Order Desk docs\n');
  fs.writeFileSync(path.join(dir, 'OrderDesk.mpr'), '');
  fs.writeFileSync(path.join(dir, 'run'), FAKE_MXCLI);
  fs.writeFileSync(path.join(dir, 'version.txt'), 'first version');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Order Desk\n\nA neutral example app for the office\'s screenshots.\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Order Desk: first version');
  fs.writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'order-desk', name: 'Order Desk', dir, palette: 2, addedBy: 'Alex Lee', addedAt: Date.now() - 86_400_000, mode: 'expert' }]));
  // An empty budget with the session as its one agent, for the phases' spend (scripts/phased-delivery-fixture.ts).
  fs.mkdirSync(path.join(data, 'budget'), { recursive: true });
  fs.writeFileSync(path.join(data, 'budget', 'order-desk.json'), JSON.stringify({ ledger: { version: 1, startedAt: Date.now() - 30 * 86_400_000, days: {}, rows: [], agents: { 'w:session': { key: 'w:session', name: 'Session', role: 'Developer', kind: 'worker' } }, seen: {}, stages: [] }, settings: { autoPause: true }, alerts: [] }));
  fs.writeFileSync(path.join(data, 'live-app.json'), JSON.stringify({ mxcli: process.execPath, ports: '8470-8489' }));
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/phased-delivery-fixture.ts', '--home', home, '--floor', 'order-desk', '--dir', dir], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) log('phases not seeded (the strip stays hidden):', `${r.stderr}\n${r.stdout}`.split('\n').filter((l) => /Error|fatal|error:/.test(l)).slice(0, 6).join(' | '));
  return { home, dir };
}

async function main() {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(out, { recursive: true });
  const { home } = fixture();
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_MODE: 'turn' } });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
    const proof = await fetch(`${office.base}/api/expert/proof?floor=order-desk`, { headers: { cookie } });
    check(proof.status === 404, `no proof module yet: GET /api/expert/proof answers ${proof.status}`);
    const newPage = async (viewport, theme) => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookies);
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', t);
      }, theme);
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      return page;
    };
    const settle = (page, ms = 1500) => page.waitForTimeout(ms);
    const noSideways = async (page, w, name) => check((await page.evaluate(() => document.documentElement.scrollWidth)) <= w, `${name}: no sideways scrolling`);
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

    // Light, first visit: arriving opens the Session screen and starts the session.
    const page = await newPage({ width: 1440, height: 900 }, 'portal-light');
    await page.goto(`${office.base}/lite?floor=order-desk`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.xs-head', { timeout: 30000 });
    check(new URL(page.url()).searchParams.get('tab') === 'session' || (await page.isVisible('#session-view')), 'arriving on an Expert-mode project opens the Session screen');
    check(!(await page.isVisible('#lead-panel')), 'no team-lead panel on an Expert-mode project');
    check(await page.evaluate(() => { const b = document.querySelector('#pt-nav [data-nav="session"]'); return !!b && !b.closest('[hidden]'); }), 'Session is listed in the navigation');
    await page.waitForSelector('.xs-term .xterm', { timeout: 30000 });
    check(true, 'the session started by itself (its terminal is showing)');
    const proofText = await page.textContent('.xs-proof');
    check(/coming soon/.test(proofText ?? ''), `the proof strip says coming soon (${proofText?.slice(0, 60)})`);
    // The app: started from the preview.
    const start = page.locator('.xs-empty button.primary');
    if (await start.count()) await start.click();
    await page.waitForSelector('.xs-frame iframe.la-frame[src]', { timeout: 90000 }).catch(() => undefined);
    check(await page.isVisible('.xs-frame iframe.la-frame[src]'), 'the preview shows the running app');
    // Type into the session as its user would (the office itself never does).
    await page.locator('.xs-term').click();
    await page.keyboard.type('Add a status filter to the orders list');
    await page.keyboard.press('Enter');
    await settle(page, 4000);
    check((await page.textContent('.xs-state'))?.length > 0, `the header says the session's state (${await page.textContent('.xs-state')})`);
    check(await page.isVisible('.xs-phases'), 'the phase strip shows for a phased project');
    check((await page.textContent('.xs-loop'))?.includes('asked → visible'), 'the preview header has the asked → visible timer');
    await noSideways(page, 1440, 'light');
    await shot(page, '01-session-light');

    // Resized: the divider by keys, 35/65; remembered after a reload.
    await page.locator('.xs-div').focus();
    for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowLeft');
    await page.locator('.xs-div').hover();
    await settle(page, 600);
    const pct = await page.getAttribute('.xs-div', 'aria-valuenow');
    check(pct === '36', `arrow keys move the divider (preview at ${pct}%)`);
    const pw = await page.evaluate(() => Math.round(document.querySelector('.xs-preview').getBoundingClientRect().width));
    check(pw >= 320, `the preview keeps at least 320 px (${pw})`);
    await shot(page, '04-session-resized');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.xs-term .xterm', { timeout: 30000 });
    await settle(page, 1500);
    check((await page.getAttribute('.xs-div', 'aria-valuenow')) === '36', 'the split is remembered for the project');
    await page.locator('.xs-div').dblclick();
    check((await page.getAttribute('.xs-div', 'aria-valuenow')) === '50', 'double-click: half and half');
    // Presets and swap.
    await page.click('.xs-seg[data-focus="chat"]');
    check(!(await page.isVisible('.xs-preview')) && (await page.isVisible('.xs-session')), 'Chat: the session only');
    await page.click('.xs-seg[data-focus="app"]');
    check((await page.isVisible('.xs-preview')) && !(await page.isVisible('.xs-session')), 'App: the preview only');
    await page.click('.xs-seg[data-focus="both"]');
    await page.click('.xs-sh .xs-icon[aria-label="Swap sides"]');
    const swapped = await page.evaluate(() => document.querySelector('.xs-session').getBoundingClientRect().left < document.querySelector('.xs-preview').getBoundingClientRect().left);
    check(swapped, 'swap puts the session on the left');
    await page.click('.xs-sh .xs-icon[aria-label="Swap sides"]');

    // The navigation folded to icons, the split still working.
    await page.click('.pt-nav-fold');
    await settle(page, 800);
    check(await page.evaluate(() => document.body.classList.contains('pt-rail')), 'the navigation folds to icons');
    await noSideways(page, 1440, 'nav folded');
    await shot(page, '03-session-nav-collapsed');
    await page.click('.pt-nav-fold');
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
    await page.context().close();

    // Dark.
    const dark = await newPage({ width: 1440, height: 900 }, 'portal-dark');
    await dark.goto(`${office.base}/lite?floor=order-desk&tab=session`, { waitUntil: 'domcontentloaded' });
    await dark.waitForSelector('.xs-term .xterm', { timeout: 30000 });
    await dark.waitForSelector('.xs-frame iframe.la-frame[src]', { timeout: 30000 }).catch(() => undefined);
    await settle(dark, 2500);
    await noSideways(dark, 1440, 'dark');
    await shot(dark, '02-session-dark');
    check(!dark.errors.length, `dark: no page errors${dark.errors.length ? `: ${dark.errors.join(' | ')}` : ''}`);
    await dark.context().close();

    // Narrow laptop: both sides still fit.
    const narrow = await newPage({ width: 1100, height: 760 }, 'portal-light');
    await narrow.goto(`${office.base}/lite?floor=order-desk&tab=session`, { waitUntil: 'domcontentloaded' });
    await narrow.waitForSelector('.xs-term .xterm', { timeout: 30000 });
    await settle(narrow, 2000);
    await noSideways(narrow, 1100, 'narrow');
    await shot(narrow, '05-session-narrow');
    await narrow.context().close();
  } finally {
    await browser.close();
    await office.stop();
  }
  const bad = checks.filter((c) => !c.ok);
  log(`${checks.length - bad.length}/${checks.length} checks passed; shots in ${out}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
