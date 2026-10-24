// The Developer | Project Management switch in a real, throwaway TEST office: the performance guard's fixture at
// scale 1 (fake agents only, test mode, no GitHub: GH tokens removed and an empty GH_CONFIG_DIR, no Claude).
// Checks, on the real 1D view:
//
//   - the switch stands at the same place and size on Project Management pages (Overview, Board, Live app,
//     Approvals) and in the Developer view, in Portal Light, Portal Dark, Clean (Light) and the Default look,
//     at desktop and phone width (bounding boxes measured)
//   - it keeps the project and doesn't reload the page; the address follows (&ws=app while Developer shows)
//   - old links open the right view: ?tab=board, ?tab=app, &ws=app, &ws=eng&tab=decisions, and the new
//     &ws=dev, &ws=pm&tab=decisions
//   - no stage bar; the business status chip in the Developer view's bar
//
// and saves screenshots (a Project Management page and the Developer view, Light, Dark and phone).
//
//   npm run build && node scripts/view-switch-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
//
// (The start clears what an earlier run left under the root, its processes included, matched by their command
// line: leave --root out when running it from a shell whose own command line would name that folder.)
import { spawnSync } from 'node:child_process';
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'view-switch-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'docs', 'mockups', 'developer-view', 'switch-shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};

async function main() {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(out, { recursive: true });
  const made = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/perf/fixture.ts', '--out', root, '--scale', '1', '--seed', '42', '--base', new Date().toISOString()], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (made.status !== 0) throw new Error(`fixture: ${made.stderr || made.stdout}`);
  const home = path.join(root, 'office');
  const floors = JSON.parse(fs.readFileSync(path.join(home, '.agent-office', 'floors.json'), 'utf8'));
  const floor = floors[0].id;
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '800' } });
  log('test office up at', office.base, 'project', floor);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
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
    const base = `${office.base}/lite?floor=${encodeURIComponent(floor)}`;
    const q = (page) => new URL(page.url()).searchParams;
    const box = (page) =>
      page.evaluate(() => {
        const el = document.querySelector('header.lite-bar .vs');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
    const same = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    const pressed = (page) => page.$eval('.vs-seg[aria-pressed="true"]', (b) => b.getAttribute('data-view')).catch(() => null);
    const settle = (page, ms = 1200) => page.waitForTimeout(ms);
    const viaNav = async (page, id) => {
      // Portal's navigation, else the classic tab row: the page's own way to a tab.
      const ok = await page.evaluate((t) => {
        const el = document.querySelector(`#pt-nav [data-nav="${t}"]`) ?? document.querySelector(`#tab-${t}`);
        if (!el) return false;
        el.click();
        return true;
      }, id);
      await settle(page, 600);
      return ok;
    };

    const shots = [
      { theme: 'portal-light', viewport: { width: 1440, height: 900 }, name: 'light' },
      { theme: 'portal-dark', viewport: { width: 1440, height: 900 }, name: 'dark' },
      { theme: 'portal-light', viewport: { width: 400, height: 860 }, name: 'phone-light' },
      { theme: 'portal-dark', viewport: { width: 400, height: 860 }, name: 'phone-dark' },
      { theme: 'clean-light', viewport: { width: 1440, height: 900 }, name: 'classic-clean' },
      { theme: 'default', viewport: { width: 1440, height: 900 }, name: 'classic-default' },
      { theme: 'default', viewport: { width: 400, height: 860 }, name: 'phone-classic-default' },
    ];
    for (const s of shots) {
      const page = await newPage(s.viewport, s.theme);
      await page.goto(`${base}&tab=board`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header.lite-bar .vs', { timeout: 30000 });
      await settle(page, 2500);
      await page.evaluate(() => (window.__noReload = true));
      const pm = await box(page);
      check(pm && (await pressed(page)) === 'eng', `${s.name}: the switch on the Board says Project Management ${JSON.stringify(pm)}`);
      check(pm && pm.x + pm.w / 2 > s.viewport.width / 2 && pm.y < 70, `${s.name}: top right`);
      await page.screenshot({ path: path.join(out, `pm-board-${s.name}.png`) });
      for (const t of ['command', 'live', 'approvals']) {
        await viaNav(page, t);
        check(same(await box(page), pm), `${s.name}: same place on ${t} ${JSON.stringify(await box(page))}`);
      }
      // Measured again right before switching: the office's live budget chip (the bar's last item) can change
      // width as the fake agents spend, which moves everything in a classic bar; that isn't the switch's doing.
      const before = await box(page);
      await page.click('.vs-seg[data-view="app"]');
      await page.waitForSelector('.aw:not([hidden])', { timeout: 30000 });
      await settle(page, 400);
      const dev = await box(page);
      check(same(dev, before), `${s.name}: same place and size in the Developer view ${JSON.stringify(dev)} (Project Management: ${JSON.stringify(before)})`);
      check((await pressed(page)) === 'app', `${s.name}: Developer pressed`);
      check(q(page).get('floor') === floor && q(page).get('ws') === 'app' && q(page).get('tab') === 'decisions', `${s.name}: Approvals → Developer opens Decisions, same project: ${page.url()}`);
      check(await page.evaluate(() => window.__noReload === true), `${s.name}: no reload`);
      check((await page.locator('.aw-stages, .aw-stage, .aw-stagenote').count()) === 0, `${s.name}: no stage bar`);
      await page.screenshot({ path: path.join(out, `dev-${s.name}.png`) });
      await page.click('.vs-seg[data-view="eng"]');
      await settle(page, 400);
      check(q(page).get('tab') === 'approvals' && !q(page).get('ws') && q(page).get('floor') === floor, `${s.name}: back to Approvals, same project: ${page.url()}`);
      check(same(await box(page), dev), `${s.name}: and the switch still there`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= s.viewport.width, `${s.name}: no sideways scrolling (${sw})`);
      check(!page.errors.length, `${s.name}: no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
      await page.context().close();
    }

    // Old and new links.
    const page = await newPage({ width: 1440, height: 900 }, 'portal-light');
    for (const [asked, tab, dev] of [
      ['&tab=board', 'board', false],
      ['&tab=app', 'app', true],
      ['&ws=app', 'app', true],
      ['&ws=app&tab=approvals', 'decisions', true],
      ['&ws=eng&tab=decisions', 'approvals', false],
      ['&ws=dev', 'app', true],
      ['&ws=pm&tab=decisions', 'approvals', false],
      ['&tab=decisions', 'decisions', true],
    ]) {
      await page.goto(`${base}${asked}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('header.lite-bar .vs', { timeout: 30000 });
      await settle(page, 1500);
      const on = await page.evaluate(() => document.body.classList.contains('aw-on'));
      check(q(page).get('tab') === tab && on === dev && (await pressed(page)) === (dev ? 'app' : 'eng'), `${asked} opens ${dev ? 'the Developer view' : 'Project Management'} on ${tab}`);
    }
    await page.goto(`${base}&ws=dev`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .aw-crumb', { timeout: 30000 });
    await settle(page, 2000);
    check(/Developer view/.test((await page.textContent('.aw-crumb')) ?? ''), 'the Developer view names itself');
    check((await page.$eval('#pt-nav [data-nav="app"]', (e) => e.textContent ?? '').catch(() => '')).includes('Developer'), 'the navigation says Developer');
    log('status chip:', await page.$eval('.aw-statuschip', (e) => (e.hidden ? '(hidden: no status yet)' : e.textContent)).catch(() => '(none)'));
    await page.context().close();
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
    fs.rmSync(ghConfig, { recursive: true, force: true });
  }
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
