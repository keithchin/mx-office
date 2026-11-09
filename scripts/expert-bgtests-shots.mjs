// Expert mode slice 6 (tests and lint in the background) in a real, throwaway TEST office: fake agents only, test
// mode, no GitHub (GH tokens removed, an empty GH_CONFIG_DIR), no Claude. One neutral Expert-mode project ("Order
// Desk"): a git folder with an empty .mpr, six journeys (tests/e2e/*.journey.js, each fetching the preview), a lint
// baseline, and a stand-in mxcli (fake-mxcli.exe, a tiny shim running fake-mxcli.mjs with node) that serves a small
// orders page for `run --watch` and prints the folder's lint.json for `lint`. Two passes:
//
//   1. the loop timer with the idle checks off (AGENT_OFFICE_EXPERT_CHECKS=0): N asked → visible cycles;
//   2. the same N cycles with them on, each next prompt landing while the previous idle run plays its journeys
//      (so the run is cancelled by the session's turn, as designed, and the reload competes with it);
//   then a run that passes, a change that breaks journey J04b and adds a lint warning, and screenshots: the strip
//   running, passing, the regression flagged, the popover, and Send to session filled in (never submitted).
//
//   Then Lock in (slice 7) on the same project, on the same runner: the breaking change undone, Run the checks runs
//   every journey on the preview (the mx check scripted with AGENT_OFFICE_TEST_LOCKIN, test mode only: no mxbuild
//   here), and screenshots of the checks running and all passed; plus the strip during the first lint run.
//
//   npm run build && node scripts/expert-bgtests-shots.mjs [--root <scratch/test-offices/...>] [--out <dir>] [--cycles 5] [--skip-timer]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';
import { SHIM_CS, csc } from './perf/journey/stubs.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'expert-bgtests')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'docs', 'mockups', 'expert-mode', 'build-shots')));
const CYCLES = Number(arg('--cycles', '5'));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FAKE_MXCLI = `import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('mxcli version v0.99.0-fake (test office)'); process.exit(0); }
if (a.includes('--help')) { console.log('  --watch   rebuild and reload on model changes'); process.exit(0); }
const mprAt = a.indexOf('-p') >= 0 ? a[a.indexOf('-p') + 1] : 'OrderDesk.mpr';
const here = path.dirname(path.resolve(mprAt));
if (a[0] === 'lint') {
  const f = path.join(here, 'lint.json');
  console.log(fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '{"violations":[]}');
  process.exit(0);
}
if (a[0] !== 'run') { console.error('fake mxcli: ' + a.join(' ')); process.exit(2); }
const port = Number(a[a.indexOf('--app-port') + 1]);
const ver = () => { try { return fs.readFileSync(path.join(here, 'version.txt'), 'utf8').trim(); } catch { return ''; } };
console.log('Building the project…');
setTimeout(() => {
  console.log('Starting the Mendix runtime…');
  const rows = [['SO-1042','Northwind Supplies','3 pallets','Packed'],['SO-1041','Blue Harbor Foods','12 boxes','Waiting'],['SO-1039','Summit Tools','1 crate','Shipped'],['SO-1038','Lakeside Office','40 reams','Waiting'],['SO-1036','Green Valley Farm','6 drums','Shipped']];
  const page = () => '<!doctype html><meta charset=utf-8><title>Order Desk</title><style>body{margin:0;font:14px system-ui,sans-serif;color:#1f2937;background:#f8fafc}header{background:#1e293b;color:#fff;padding:12px 20px;display:flex;gap:18px;align-items:center}header b{font-size:15px}header span{opacity:.8}main{padding:20px}h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 16px}.cards{display:flex;gap:10px;margin-bottom:16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:4px;padding:10px 14px;min-width:90px}.card b{display:block;font-size:18px}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0}th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #eef2f7}th{background:#f1f5f9;font-weight:600}.s{padding:2px 8px;border-radius:10px;font-size:12px;background:#e0f2fe}</style><header><b>Order Desk</b><span>Orders</span><span>Customers</span><span>Reports</span></header><main><h1>Orders</h1><p>Orders waiting to ship, newest first. (' + ver() + ')</p><div class=cards><div class=card>Waiting<b>2</b></div><div class=card>Packed<b>1</b></div><div class=card>Shipped<b>2</b></div></div><table><tr><th>Order</th><th>Customer</th><th>Goods</th><th>Status</th></tr>' + rows.map((r) => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td><span class=s>' + r[3] + '</span></td></tr>').join('') + '</table></main>';
  http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(page()); }).listen(port, () => console.log('Runtime started'));
  let n = 1;
  if (a.includes('--watch')) fs.watchFile(path.join(here, 'version.txt'), { interval: 200 }, () => {
    n++;
    console.log('Change detected, rebuilding (build #' + n + ')...');
    setTimeout(() => console.log('build #' + n + ' applied via reload in 1.2s, 1 page'), 1200);
  });
}, 800);
`;

/** A journey script: fetches the preview, checks a thing, writes its findings (the recorder shape). */
const journey = (id, title, steps, breaksOn) => `// ${id}: ${title} (a neutral example journey for the office's test office).
const fs = require('fs');
const path = require('path');
(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const text = await (await fetch(process.env.APP_URL + '/')).text();
  const broken = ${breaksOn ? `/${breaksOn}/.test(text)` : 'false'};
  const ok = /Orders/.test(text) && !broken;
  const steps = ${JSON.stringify(steps)}.map((name, i, all) => ({ name, status: ok || i < all.length - 1 ? 'PASS' : 'FAIL', ...(ok || i < all.length - 1 ? {} : { error: 'the status chip still shows “Waiting” after the planner approved the order' }) }));
  fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'artifacts', '${id}.findings.json'), JSON.stringify({ verdict: ok ? 'PASS' : 'FAIL', steps }));
  process.exit(ok ? 0 : 1);
})();
`;

const LINT_BASE = [
  { ruleId: 'CONV010', severity: 'warning', module: 'Orders', document: 'ACT_Order_Save', message: 'Microflow has no error handler on its commit' },
  { ruleId: 'MPR002', severity: 'info', module: 'Orders', document: 'Order_Overview', message: 'Page has no title' },
  { ruleId: 'CONV010', severity: 'warning', module: 'Customers', document: 'ACT_Customer_Merge', message: 'Microflow has no error handler on its commit' },
];
const fkey = (v) => [v.ruleId, v.module, v.document, v.message].join('|');

function fixture() {
  const home = path.join(root, 'office');
  const data = path.join(home, '.agent-office');
  const dir = path.join(root, 'projects', 'order-desk');
  const stubs = path.join(root, 'stubs');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests', 'e2e'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.mkdirSync(stubs, { recursive: true });
  // The stand-in mxcli: an .exe the office can run without a shell, running node on the .mjs beside it.
  fs.writeFileSync(path.join(stubs, 'fake-mxcli.mjs'), FAKE_MXCLI);
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(stubs, 'shim.cs'), SHIM_CS);
    execFileSync(csc(), ['/nologo', '/optimize', `/out:${path.join(stubs, 'fake-mxcli.exe')}`, path.join(stubs, 'shim.cs')], { stdio: 'pipe', windowsHide: true });
  } else {
    fs.writeFileSync(path.join(stubs, 'fake-mxcli'), `#!/bin/sh\nexec node "$(dirname "$0")/fake-mxcli.mjs" "$@"\n`);
    fs.chmodSync(path.join(stubs, 'fake-mxcli'), 0o755);
  }
  const mxcli = path.join(stubs, process.platform === 'win32' ? 'fake-mxcli.exe' : 'fake-mxcli');
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Alex Lee');
  git('config', 'user.email', 'alex@example.invalid');
  fs.writeFileSync(path.join(dir, 'OrderDesk.mpr'), '');
  fs.writeFileSync(path.join(dir, 'version.txt'), 'first version');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), "# Order Desk\n\nA neutral example app for the office's screenshots.\n");
  fs.writeFileSync(path.join(dir, '.gitignore'), 'tests/e2e/artifacts/\n');
  fs.writeFileSync(path.join(dir, 'lint.json'), JSON.stringify({ violations: LINT_BASE }));
  fs.writeFileSync(path.join(dir, '.claude', 'lint-baseline.json'), JSON.stringify({ counts: { CONV010: 2, MPR002: 1 }, total: 3, findings: Object.fromEntries(LINT_BASE.map((v) => [fkey(v), 1])) }, null, 2));
  const js = [
    ['J01', 'Clerk sees the open orders', ['Open the orders list', 'Five orders show']],
    ['J02', 'Clerk filters by status', ['Open the orders list', 'Filter on Waiting', 'Two orders show']],
    ['J03', 'Clerk opens an order', ['Open SO-1042', 'The goods show']],
    ['J04', 'Planner sees waiting orders', ['Sign in as the planner', 'Waiting orders show']],
    ['J04b', 'Planner approves an order', ['Open SO-1041', 'Approve it', 'Status chip shows “Approved”'], 'broken'],
    ['J05', 'Clerk ships an order', ['Open SO-1042', 'Mark it shipped', 'It moves to Shipped']],
  ];
  for (const [id, title, steps, breaks] of js) fs.writeFileSync(path.join(dir, 'tests', 'e2e', `${id}.journey.js`), journey(id, title, steps, breaks));
  git('add', '-A');
  git('commit', '-q', '-m', 'Order Desk: first version');
  fs.writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'order-desk', name: 'Order Desk', dir, palette: 2, addedBy: 'Alex Lee', addedAt: Date.now() - 86_400_000, mode: 'expert' }]));
  fs.writeFileSync(path.join(data, 'live-app.json'), JSON.stringify({ mxcli, ports: '8470-8489' }));
  fs.mkdirSync(path.join(data, 'budget'), { recursive: true });
  fs.writeFileSync(path.join(data, 'budget', 'order-desk.json'), JSON.stringify({ ledger: { version: 1, startedAt: Date.now() - 30 * 86_400_000, days: {}, rows: [], agents: { 'w:session': { key: 'w:session', name: 'Session', role: 'Developer', kind: 'worker' } }, seen: {}, stages: [] }, settings: { autoPause: true, total: 800 }, alerts: [] }));
  return { home, dir };
}

async function pass({ home, dir, checksOn, shots }) {
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const lockinScript = path.join(root, 'lockin-script.json');
  fs.writeFileSync(lockinScript, JSON.stringify({ over: true, checks: { 'mx-check': { status: 'passed', summary: '0 errors' } }, licence: 'free', demoUsers: { on: false, count: 0 } }));
  const office = await startTestOffice({ home, env: { AGENT_OFFICE_TEST_LOCKIN: lockinScript, GH_CONFIG_DIR: ghConfig, FAKE_MODE: 'turn', FAKE_TURN_MS: '6000', FAKE_RATE_MS: '500', FAKE_ECHO: '1', FAKE_NODE: process.execPath, AGENT_OFFICE_EXPERT_CHECKS: checksOn ? '1' : '0' } });
  log(`test office up at ${office.base} (idle checks ${checksOn ? 'on' : 'off'})`);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  const samples = [];
  try {
    const cookie = await login(office.base);
    const api = async (p) => (await fetch(`${office.base}${p}`, { headers: { cookie } })).json();
    const u = new URL(office.base);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' })));
    await ctx.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
      localStorage.setItem('agent-office.color-theme', 'portal-light');
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || errors.push(e.message));
    await page.goto(`${office.base}/lite?floor=order-desk&tab=session`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.xs-term .xterm', { timeout: 30000 });
    const start = page.locator('.xs-empty button.primary');
    await page.waitForTimeout(1500);
    if (await start.count()) await start.click();
    await page.waitForSelector('.xs-frame iframe.la-frame[src]', { timeout: 90000 }).catch(() => undefined);
    check(await page.isVisible('.xs-frame iframe.la-frame[src]'), 'the preview runs the app');
    const proof = () => api('/api/expert/proof?floor=order-desk');
    const loop = async () => (await api('/api/expert?floor=order-desk')).loop ?? {};
    const waitFor = async (fn, ms, what) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const v = await fn().catch(() => undefined);
        if (v) return v;
        await sleep(400);
      }
      log(`  (gave up waiting for ${what})`);
      return undefined;
    };
    let n = 0;
    /** One ask: typed into the session, the model and the page change while it works; the timer's sample. */
    const cycle = async (what, opts = {}) => {
      n++;
      const before = (await loop()).count ?? 0;
      await page.locator('.xs-term').click();
      await page.keyboard.type(what);
      await page.keyboard.press('Enter');
      await sleep(1500);
      fs.writeFileSync(path.join(dir, 'OrderDesk.mpr'), `model change ${n}`);
      await sleep(2000);
      if (opts.lint) fs.writeFileSync(path.join(dir, 'lint.json'), JSON.stringify({ violations: opts.lint }));
      fs.writeFileSync(path.join(dir, 'version.txt'), opts.version ?? `change ${n}`);
      const l = await waitFor(async () => {
        const v = await loop();
        return (v.count ?? 0) > before ? v : undefined;
      }, 30000, 'the reload');
      if (l) samples.push(l.lastMs);
      return l;
    };

    for (let i = 0; i < CYCLES; i++) {
      const l = await cycle(`Change ${i + 1}: add a status filter to the orders list`);
      log(`  cycle ${i + 1}: asked → visible ${l ? `${(l.lastMs / 1000).toFixed(1)} s` : 'not measured'}`);
      // The first idle run lints for the first time: the strip says it may take a few minutes.
      if (checksOn && shots && i === 0) {
        const first = await waitFor(async () => (/first lint run/.test((await proof()).lint?.note ?? '') ? true : undefined), 45000, 'the first lint run');
        check(first, 'the first lint run says it may take a few minutes');
        if (first) {
          await sleep(500);
          check(/first lint run, may take a few minutes/.test((await page.textContent('.xs-proof')) ?? ''), 'LINT shows it in the strip');
          await page.screenshot({ path: path.join(out, '30-bgtests-first-lint.png') });
        }
      }
      // The next ask lands while the idle run plays its journeys (checks on), or after as long (checks off).
      if (checksOn) await waitFor(async () => ((await proof()).tests?.state === 'running' && /journey/.test((await proof()).tests?.now ?? '') ? true : undefined), 45000, 'the idle run');
      else await sleep(19000);
    }

    if (shots) {
      // Let the last run finish: everything passes at that commit.
      const done = await waitFor(async () => {
        const p = await proof();
        return p.tests?.state === 'done' && p.lint?.state === 'done' ? p : undefined;
      }, 90000, 'a finished run');
      check(done && done.tests.failures.length === 0 && done.tests.journeys.passed === 6, `a run passes: ${done ? `${done.tests.journeys.passed}/${done.tests.journeys.total} journeys, lint ${done.lint.errors}/${done.lint.warnings}` : 'none'}`);
      await sleep(1500);
      await page.screenshot({ path: path.join(out, '30-bgtests-passing.png') });
      // A change that breaks J04b and adds a lint warning.
      const extra = { ruleId: 'CONV010', severity: 'warning', module: 'Orders', document: 'ACT_Order_Approve', message: 'Microflow has no error handler on its commit' };
      await cycle('Add an approve button for planners on the order page', { version: 'approve button added (broken status chip)', lint: [...LINT_BASE, extra] });
      const running = await waitFor(async () => ((await proof()).tests?.state === 'running' && /journey J0[3-5]/.test((await proof()).tests?.now ?? '') ? true : undefined), 60000, 'the run on the breaking change');
      check(running, 'the strip shows the run under way');
      await sleep(600);
      await page.screenshot({ path: path.join(out, '30-bgtests-running.png') });
      check(/running/i.test((await page.textContent('.xs-proof')) ?? ''), 'TESTS says running…');
      const flagged = await waitFor(async () => {
        const p = await proof();
        return p.tests?.state === 'done' && p.tests.failures.length ? p : undefined;
      }, 90000, 'the regression');
      const f = flagged?.tests.failures[0];
      check(f?.id === 'J04b' && !!f.passedAt, `J04b flagged as a regression (passed at ${f?.passedAt?.slice(0, 7)})`);
      check(flagged?.lint.warnings === 1 && flagged.lint.errors === 0, `lint: ${flagged?.lint.errors} errors +${flagged?.lint.warnings} warn`);
      const testing = await api('/api/testing?floor=order-desk').catch(() => undefined);
      check(!!testing, 'the Testing page’s data answers');
      await sleep(1500);
      const strip = (await page.textContent('.xs-proof')) ?? '';
      check(/5\/6 journeys · J04b regressed · 0 microflow/.test(strip) && /0 errors \+1 warn/.test(strip), `the strip: ${strip.replace(/\s+/g, ' ').slice(0, 200)}`);
      await page.screenshot({ path: path.join(out, '30-bgtests-regression.png') });
      // The popover, from the TESTS cell.
      await page.click('.xs-pbtn:has-text("Tests")');
      await page.waitForSelector('.xs-ck', { timeout: 5000 });
      await sleep(400);
      const pop = (await page.textContent('.xs-ck')) ?? '';
      check(/J04b/.test(pop) && /Passed on/.test(pop) && /5 other journeys passed/.test(pop), `the popover lists the regression (${pop.replace(/\s+/g, ' ').slice(0, 160)})`);
      await page.screenshot({ path: path.join(out, '30-bgtests-popover.png') });
      // Esc closes it and gives focus back to the cell.
      await page.keyboard.press('Escape');
      check(!(await page.isVisible('.xs-ck')) && (await page.evaluate(() => document.activeElement?.classList.contains('xs-pbtn'))), 'Esc closes the popover and focus goes back to the cell');
      await page.click('.xs-pbtn:has-text("Tests")');
      await page.waitForSelector('.xs-ck');
      const sendBtn = page.locator('.xs-ck-send');
      await waitFor(async () => ((await sendBtn.isEnabled()) ? true : undefined), 20000, 'the session idle');
      check(await sendBtn.isEnabled(), 'Send to session is enabled while the session waits at its prompt');
      const turnsBefore = (await page.textContent('.xs-term')) ?? '';
      await sendBtn.click();
      await sleep(1500);
      const term = (await page.textContent('.xs-term')) ?? '';
      check(/Journey J04b failed in the background check/.test(term), 'the prompt is in the session’s input line');
      check(!/Done \(fake\): Journey J04b/.test(term) && (term.match(/Done \(fake\)/g) ?? []).length === (turnsBefore.match(/Done \(fake\)/g) ?? []).length, 'it was not submitted: no new turn');
      check(!(await page.isVisible('.xs-ck')), 'the popover closed after sending');
      await page.screenshot({ path: path.join(out, '30-bgtests-send-filled.png') });
      // While the session works, Send is disabled with the reason.
      await page.locator('.xs-term').click();
      await page.keyboard.press('Enter');
      await sleep(1200);
      await page.click('.xs-pbtn:has-text("Tests")');
      await page.waitForSelector('.xs-ck');
      await sleep(300);
      check(await sendBtn.isDisabled(), 'Send to session is disabled while the session works');
      check(/working/i.test((await page.textContent('.xs-ck-why')) ?? ''), `with the reason: ${await page.textContent('.xs-ck-why')}`);
      await page.screenshot({ path: path.join(out, '30-bgtests-send-disabled.png') });
      await page.keyboard.press('Escape');
      // The narrow window: the strip and the popover fit.
      check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440, 'no sideways scrolling');
      check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      // Dark.
      await page.context().addInitScript(() => localStorage.setItem('agent-office.color-theme', 'portal-dark'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.xs-pbtn', { timeout: 30000 });
      await sleep(2500);
      await page.click('.xs-pbtn:has-text("Lint")');
      await page.waitForSelector('.xs-ck');
      await sleep(400);
      await page.screenshot({ path: path.join(out, '30-bgtests-lint-dark.png') });
      await page.keyboard.press('Escape');

      // Lock in on the same runner: the breaking change undone, then every journey at the head.
      await page.context().addInitScript(() => localStorage.setItem('agent-office.color-theme', 'portal-light'));
      fs.writeFileSync(path.join(dir, 'version.txt'), 'approve button added (status chip fixed)');
      fs.writeFileSync(path.join(dir, 'lint.json'), JSON.stringify({ violations: LINT_BASE }));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.xs-lockin:not([disabled])', { timeout: 60000 });
      await sleep(4000);
      await page.click('.xs-lockin');
      await page.waitForSelector('.xl .xl-row', { timeout: 20000 });
      await page.click('.xl-primary');
      const journeyRunning = await waitFor(async () => ((await page.textContent('.xl-row[data-state="running"]').catch(() => '')) ? true : undefined), 120000, 'Lock in running');
      check(journeyRunning, 'Lock in shows its checks running');
      await waitFor(async () => (/Journeys\s*Running/.test((await page.textContent('.xl')) ?? '') ? true : undefined), 120000, 'the journeys running');
      await sleep(400);
      await page.screenshot({ path: path.join(out, '40-lockin-checks-running.png') });
      const ran = await waitFor(async () => (/^ran /.test((await page.textContent('.xl-meta').catch(() => '')) ?? '') ? true : undefined), 300000, 'Lock in finished');
      check(ran, 'Lock in finished');
      await sleep(800);
      const panel = (await page.textContent('.xl')) ?? '';
      check(/Journeys\s*6 of 6 passed/.test(panel), `Lock in ran every journey (${panel.match(/Journeys[^A-Z]*/)?.[0]})`);
      await page.screenshot({ path: path.join(out, '40-lockin-all-passed.png') });
      check(!errors.length, `no page errors after Lock in${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    }
  } finally {
    await browser.close();
    await office.stop();
  }
  return samples;
}

const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN;
};
const s1 = (ms) => `${(ms / 1000).toFixed(1)} s`;

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const results = {};
  for (const on of process.argv.includes('--skip-timer') ? [true] : [false, true]) {
    if (fs.existsSync(root)) {
      killProcessesUnder(root);
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    }
    const f = fixture();
    results[on ? 'on' : 'off'] = await pass({ ...f, checksOn: on, shots: on });
  }
  for (const k of Object.keys(results)) {
    const xs = results[k].slice(0, CYCLES);
    log(`loop timer, idle checks ${k}: ${xs.map(s1).join(', ')} · median ${s1(med(xs))} · max ${s1(Math.max(...xs))}`);
  }
  const bad = checks.filter((c) => !c.ok);
  log(`${checks.length - bad.length}/${checks.length} checks passed; shots in ${out}`);
  if (bad.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
