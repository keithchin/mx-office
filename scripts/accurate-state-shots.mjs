// Increment A's accurate-state items, smoke-tested on a throwaway TEST office (the performance guard's fixture,
// fake agents, test mode, GH tokens removed and an empty GH_CONFIG_DIR, no Claude, an empty file as the live app's
// mxcli so a start fails for real without building anything), in a real Chromium (new headless), Light, Dark, phone:
//
//   - the one Needs-you count: the bell, the navigation's Overview item, the Overview's Needs you card and the
//     lead panel's banner say the same number at the same moment
//   - ✅ Accept: the acceptance record and the dialog list what will refuse it before pressing (enforced first)
//   - Status unknown with its reasons and links (a project whose main has no commit yet)
//   - the Developer view after a failed live-app start: the canvas line, the Live preview tab and the chat header
//     say why, not a bare "not running"
//   - a bare no-Origin JSON POST is refused; the page's own requests go through
//
//   npm run build && node scripts/accurate-state-shots.mjs [--out <dir>] [--gh <empty dir>]
//
// The test office's root is fixed under scratch/test-offices (cleared at the start, its processes included,
// matched by command line), so it is never on this script's own command line.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.join(REPO, '..', '..', 'scratch', 'test-offices', 'accurate-state-shots');
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'docs', 'mockups', 'product-assessment', 'increment-a-state-shots')));
const ghEmpty = path.resolve(arg('--gh', path.join(REPO, '..', '..', 'scratch', 'empty-gh')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });

async function shoot(page, name, { themes = ['portal-light', 'portal-dark'] } = {}) {
  await page.evaluate(() => document.getElementById('toasts')?.replaceChildren());
  for (const t of themes) {
    await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`) });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
}

const counts = (page) =>
  page.evaluate(`(() => {
    const t = (s) => (document.querySelector(s)?.textContent ?? '').trim();
    return { tab: t('#tab-command .ny-tab-n'), nav: t('.pt-item[data-nav="command"] .pt-nbadge'), bell: t('.pt-bell .pt-count'), phone: t('.tp-launch .tp-badge'), overview: t('.pt-needs .pt-badge'), banner: t('#lead-panel .lp-wait'), bellLabel: document.querySelector('.pt-bell')?.getAttribute('aria-label') ?? '' };
  })()`);

async function main() {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(ghEmpty, { recursive: true });
  if (fs.readdirSync(ghEmpty).length) throw new Error(`${ghEmpty} must be empty`);
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '1', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) throw new Error(`fixture: ${made.stderr || made.stdout}`);
  const home = path.join(root, 'office');
  const floorsFile = path.join(home, '.agent-office', 'floors.json');
  const floors = JSON.parse(fs.readFileSync(floorsFile, 'utf8'));
  const teamFloor = floors[0];
  // A project whose main has no commit yet: its business status is unknown, with reasons.
  const empty = path.join(root, 'floors', 'empty-app');
  fs.mkdirSync(empty, { recursive: true });
  git(['init', '-b', 'main'], empty);
  floors.push({ id: 'empty-app', name: 'New app (no commits yet)', dir: empty, palette: floors.length, addedBy: 'the office', addedAt: Date.now() - 3_600_000 });
  fs.writeFileSync(floorsFile, JSON.stringify(floors));
  // An empty file as mxcli: the office finds it, so ▶ Start is offered, and the start fails for real (it can't run).
  const fakeMxcli = path.join(root, 'fake-mxcli.exe');
  fs.writeFileSync(fakeMxcli, '');
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghEmpty, FAKE_RATE_MS: '800', AGENT_OFFICE_LIVE_MXCLI: fakeMxcli } });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome(), args: ['--headless=new'] });
  try {
    const cookie = await login(office.base);
    // ---- 5. A bare no-Origin JSON POST from elsewhere is refused; with the office's Origin it reaches the route.
    const bare = await fetch(`${office.base}/api/acceptance`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ floor: teamFloor.id, action: 'accept' }) });
    check(bare.status === 403 && /didn't come from the office's page/.test((await bare.json()).error ?? ''), `a bare no-Origin JSON POST is refused (${bare.status})`);
    const token = (await (await fetch(`${office.base}/api/csrf`, { headers: { cookie } })).json()).token;
    const tool = await fetch(`${office.base}/api/acceptance`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-mx-office-csrf': token }, body: JSON.stringify({ floor: teamFloor.id, action: 'accept' }) });
    check(tool.status !== 403 || !/office's page/.test((await tool.json()).error ?? ''), `a tool with the session's request token reaches the route (${tool.status})`);

    const newPage = async (viewport) => {
      const u = new URL(office.base);
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookie.split('; ').map((x) => ({ name: x.slice(0, x.indexOf('=')), value: x.slice(x.indexOf('=') + 1), domain: u.hostname, path: '/' })));
      await ctx.addInitScript(() => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', 'portal-light');
      });
      const page = await ctx.newPage();
      page.errors = [];
      page.posts = [];
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      page.on('response', (r) => r.request().method() === 'POST' && page.posts.push(`${r.status()} ${new URL(r.url()).pathname}`));
      return page;
    };

    // ---- 1. The one count on the Overview.
    const page = await newPage({ width: 1440, height: 900 });
    await page.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&tab=command`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.pt-needs .pt-badge', { timeout: 60000 });
    await page.waitForTimeout(4000);
    const c = await counts(page);
    const n = c.tab || '0';
    check(c.overview === (c.tab ? `${n} for you` : 'All clear') || c.overview === 'Nothing for you', `Overview card: ${c.overview}`);
    check((c.nav || '') === (c.tab || '') && (c.bell || '') === (c.tab || '') && (c.phone || '') === (c.tab || ''), `the same number on the tab (${c.tab}), the nav (${c.nav}), the bell (${c.bell}) and the phone (${c.phone})`);
    check(!c.banner || new RegExp(`^⚑?\\s*${n} waiting on you`).test(c.banner), `the lead panel's banner: ${c.banner || '(hidden: no lead at work)'}`);
    log('bell label:', c.bellLabel);
    await shoot(page, 'a-01-one-count-overview');

    // ---- 2. Accept's blockers before pressing: the acceptance record, then the dialog.
    const pg = await page.$('.pg-label, .pg-accept, [data-open="acceptance"]');
    if (pg) {
      await pg.click();
      await page.waitForSelector('.acc-modal', { timeout: 20000 });
      await page.waitForSelector('.acc-gates', { timeout: 60000 }).catch(() => undefined);
      const gates = await page.textContent('.acc-modal').catch(() => '');
      check(/Before you accept/.test(gates ?? '') && /Enforced by the office/.test(gates ?? ''), 'the acceptance record lists what would refuse Accept');
      await shoot(page, 'a-02-acceptance-record-gates');
      const go = await page.$('.acc-modal footer .btn.primary');
      if (go) {
        await go.click();
        await page.waitForSelector('.acc-modal .acc-gates', { timeout: 60000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        const dis = await page.evaluate(() => document.querySelector('.acc-modal footer .btn.primary')?.disabled);
        const stops = (await page.textContent('.acc-modal footer').catch(() => '')) ?? '';
        check(/Accept is refused until/.test(stops) ? dis === true : dis === false, `the dialog: ${stops.replace(/\s+/g, ' ').slice(0, 160)} (Accept ${dis ? 'disabled' : 'enabled'})`);
        await shoot(page, 'a-03-accept-dialog-gates');
        await page.keyboard.press('Escape');
      }
    } else check(false, 'no progress bar to open the acceptance record from on this project');

    // ---- 3. Status unknown with its reasons: a project whose main has no commit.
    const up = await newPage({ width: 1440, height: 900 });
    await up.goto(`${office.base}/lite?floor=empty-app&ws=dev`, { waitUntil: 'domcontentloaded' });
    await up.waitForSelector('#lead-panel .dk-head', { timeout: 60000 });
    await up.waitForSelector('#lead-panel .dk-unknown', { timeout: 30000 }).catch(() => undefined);
    const why = (await up.textContent('#lead-panel .dk-unknown').catch(() => '')) ?? '';
    check(/Why the status is unknown/.test(why) && /Check the folder on Git/.test(why) && /Start the app/.test(why), `Status unknown says why: ${why.replace(/\s+/g, ' ').slice(0, 200)}`);
    await shoot(up, 'a-04-status-unknown-reasons');
    await up.goto(`${office.base}/lite?floor=empty-app&tab=command`, { waitUntil: 'domcontentloaded' });
    await up.waitForTimeout(3000);
    await shoot(up, 'a-05-status-unknown-overview', { themes: ['portal-light'] });
    // No commit to accept: the dialog says so, and Accept is disabled before it's pressed.
    const pg2 = await up.$('.pg-label, .pg-accept, [data-open="acceptance"]');
    if (pg2) {
      await pg2.click();
      await up.waitForSelector('.acc-modal footer .btn.primary', { timeout: 30000 }).catch(() => undefined);
      const go2 = await up.$('.acc-modal footer .btn.primary');
      if (go2) {
        await go2.click();
        await up.waitForSelector('.acc-modal .acc-gates', { timeout: 60000 }).catch(() => undefined);
        await up.waitForTimeout(500);
        const dis2 = await up.evaluate(() => document.querySelector('.acc-modal footer .btn.primary')?.disabled);
        const foot2 = (await up.textContent('.acc-modal footer').catch(() => '')) ?? '';
        check(dis2 === true && /refused until/.test(foot2), `no delivery commit: Accept disabled before pressing: ${foot2.replace(/\s+/g, ' ').slice(0, 160)}`);
        await shoot(up, 'a-03b-accept-dialog-blocked');
        await up.keyboard.press('Escape');
      }
    } else log('no progress bar on the empty project');

    // ---- 4. A failed live-app start in the Developer view: start it (the mxcli doesn't exist), then look.
    const dv = await newPage({ width: 1440, height: 900 });
    await dv.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&tab=live`, { waitUntil: 'domcontentloaded' });
    await dv.waitForTimeout(2500);
    const start = dv.locator('#liveapp-view button.btn.primary', { hasText: 'Start' }).first();
    await start.waitFor({ state: 'visible', timeout: 30000 }).catch(() => undefined);
    check(await start.isVisible().catch(() => false), 'the Live app page offers ▶ Start');
    await start.click().catch((e) => log('start:', e.message));
    await dv.waitForFunction(() => /failed|didn.t come up/i.test(document.querySelector('#liveapp-view')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
    await shoot(dv, 'a-06a-live-app-page-failed', { themes: ['portal-light'] });
    await dv.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&ws=dev`, { waitUntil: 'domcontentloaded' });
    await dv.waitForSelector('#lead-panel .dk-head', { timeout: 60000 });
    await dv.click('.aw-tab[data-view="live"]');
    await dv.waitForTimeout(2000);
    const tab = (await dv.textContent('.aw-tab[data-view="live"]')) ?? '';
    const runline = (await dv.textContent('.aw-runline').catch(() => '')) ?? '';
    const head = (await dv.textContent('#lead-panel .dk-preview').catch(() => '')) ?? '';
    check(/build failed|not running/.test(tab), `the Live preview tab: ${tab}`);
    check(/Preview not running: the last (start|build) failed/.test(runline) && /Live app page/.test(runline), `the canvas line: ${runline.replace(/\s+/g, ' ').slice(0, 220)}`);
    check(/Preview not running/.test(head), `the chat header: ${head.replace(/\s+/g, ' ').slice(0, 220)}`);
    await shoot(dv, 'a-06-dev-view-failed-start');

    // ---- Phone width: the Overview and the Developer view, no sideways scrolling.
    const phone = await newPage({ width: 390, height: 844 });
    await phone.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&tab=command`, { waitUntil: 'domcontentloaded' });
    await phone.waitForTimeout(4000);
    check((await phone.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'phone: no sideways scrolling on the Overview');
    await shoot(phone, 'a-07-phone-overview', { themes: ['portal-light', 'portal-dark'] });
    await phone.goto(`${office.base}/lite?floor=${encodeURIComponent(teamFloor.id)}&ws=dev`, { waitUntil: 'domcontentloaded' });
    await phone.waitForTimeout(3000);
    await phone.click('.aw-tab[data-view="live"]').catch(() => undefined);
    await phone.waitForTimeout(1200);
    check((await phone.evaluate(() => document.documentElement.scrollWidth)) <= 391, 'phone: no sideways scrolling in the Developer view');
    await shoot(phone, 'a-08-phone-dev-view-failed', { themes: ['portal-light'] });
    for (const p of [page, up, dv, phone]) {
      check(!p.errors.length, `no page errors${p.errors.length ? `: ${p.errors.join(' | ')}` : ''}`);
      const refused = p.posts.filter((x) => x.startsWith('403'));
      check(!refused.length, `the page's own POSTs were not refused by the Origin rule${refused.length ? `: ${refused.join(', ')}` : ''}`);
    }
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
  }
  const failed = checks.filter((x) => !x.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(checks, null, 1));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
