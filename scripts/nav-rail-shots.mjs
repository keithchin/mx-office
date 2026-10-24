// The left sidebars folded to icon rails, in a real, throwaway TEST office: the performance guard's fixture
// at scale 1 (fake agents only, test mode, no GitHub: GH tokens removed and an empty GH_CONFIG_DIR, no Claude).
// On the real 1D view, in Portal Light and Dark:
//
//   - the Portal navigation open and folded (« beside Home, then [ to unfold), a group's flyout from the rail,
//     the page beside it never scrolling sideways at 1024 and 1440 px
//   - the Developer view's explorer collapsed to its rail, and opened at a section from it
//
// and saves screenshots of each.
//
//   npm run build && node scripts/nav-rail-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'nav-rail-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'docs', 'mockups', 'developer-view', 'rail-shots')));
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
    const settle = (page, ms = 600) => page.waitForTimeout(ms);
    const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const overlap = (page) => page.evaluate(() => document.querySelector('.lite-main').getBoundingClientRect().left < document.getElementById('pt-nav').getBoundingClientRect().right - 0.5);
    const navW = (page) => page.evaluate(() => Math.round(document.getElementById('pt-nav').getBoundingClientRect().width));

    for (const theme of ['portal-light', 'portal-dark']) {
      const name = theme.replace('portal-', '');
      const page = await newPage({ width: 1440, height: 900 }, theme);
      await page.goto(`${base}&tab=command`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pt-nav .pt-nav-fold', { timeout: 30000 });
      await settle(page, 2500);
      check((await navW(page)) > 200, `${name}: open pane (${await navW(page)}px)`);
      check(!(await sideways(page)) && !(await overlap(page)), `${name}: open, the page fits`);
      await page.screenshot({ path: path.join(out, `nav-expanded-${name}.png`) });
      await page.click('#pt-nav .pt-nav-fold');
      await settle(page);
      check((await navW(page)) === 56, `${name}: folded to 56px (${await navW(page)}px)`);
      check(!(await sideways(page)) && !(await overlap(page)), `${name}: folded, the page fits`);
      check(await page.locator('.pt-group.has-current > .pt-group-h').count() === 1, `${name}: the page's group highlighted`);
      await page.mouse.move(800, 600);
      await page.screenshot({ path: path.join(out, `nav-collapsed-${name}.png`) });
      await page.focus('.pt-group-h[data-group="pm"]');
      await page.keyboard.press('Enter');
      await settle(page, 200);
      check(await page.isVisible('.pt-flyout'), `${name}: Project Management's flyout`);
      await page.screenshot({ path: path.join(out, `nav-collapsed-flyout-${name}.png`) });
      await page.keyboard.press('Escape');
      check((await page.evaluate(() => document.activeElement?.dataset.group)) === 'pm', `${name}: Esc gives the focus back`);
      await page.setViewportSize({ width: 1024, height: 768 });
      await settle(page);
      check(!(await sideways(page)), `${name}: folded at 1024, no sideways scrolling`);

      // The Developer view (no project navigation there: the explorer is its left sidebar), collapsed to its rail.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.click('#pt-nav .pt-group-h[data-group="general"]');
      await page.click('.pt-fly-item[data-nav="app"]');
      await page.waitForSelector('.aw:not([hidden]) .ax-collapse', { timeout: 30000 });
      await settle(page, 1500);
      if (!(await page.evaluate(() => !!document.querySelector('.ax.ax-collapsed')))) await page.click('.ax-collapse');
      await settle(page);
      const rail = await page.$$eval('.ax-rail .ax-rail-btn', (b) => b.filter((x) => !x.hidden).map((x) => x.title));
      check(rail.includes('Documents') && rail.includes('Find') && rail.includes('Show all files'), `${name}: the explorer's rail: ${rail.join(', ')}`);
      check(!(await sideways(page)), `${name}: Developer view, no sideways scrolling`);
      await page.mouse.move(800, 600);
      await page.screenshot({ path: path.join(out, `dev-explorer-collapsed-${name}.png`) });
      await page.click('[data-ax-rail="docs:documents"]');
      await settle(page);
      check((await page.evaluate(() => document.activeElement?.dataset.id)) === 'docs:documents', `${name}: Documents opens the explorer at Documents`);
      await page.screenshot({ path: path.join(out, `dev-explorer-open-${name}.png`) });
      check(!page.errors.length, `${name}: no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
      await page.context().close();
    }
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
