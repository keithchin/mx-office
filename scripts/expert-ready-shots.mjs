// Expert mode, slice 4: the readiness check of an existing toolkit project, in a real, throwaway TEST office (test
// mode, fake agents, no GitHub tokens and an empty GH_CONFIG_DIR, no Mendix token, so Team Server is never called).
// One neutral fixture folder (scripts/expert-ready-fixture.ts: "Order Desk"). Through the real pages: ➕ Add project ›
// Open existing toolkit project, type the path, Check folder; then checks that the rows are there, that the check
// left the folder as it was (git status, every file's size and time), that Pin and Set budget write only what they
// say, Esc closes it; Portal Light and Dark and a narrow window; and saves screenshots. Each run uses a new
// folder under --root (nothing is deleted).
//
//   npm run build && node scripts/expert-ready-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const base = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'expert-ready')));
const root = path.join(base, `run-${Date.now()}`);
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'expert-ready', 'shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN', 'MENDIX_PAT']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};

/** Every file in the folder (.git too): size and time. */
function stamp(dir) {
  const o = {};
  const go = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) go(f);
      else {
        const s = fs.statSync(f);
        o[path.relative(dir, f)] = `${s.size}|${s.mtimeMs}`;
      }
    }
  };
  go(dir);
  return o;
}
const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const home = path.join(root, 'office');
  const dir = path.join(root, 'projects', 'order-desk');
  fs.mkdirSync(path.join(home, '.agent-office'), { recursive: true });
  fs.writeFileSync(path.join(home, '.agent-office', 'floors.json'), '[]');
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/expert-ready-fixture.ts', '--dir', dir], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`fixture: ${r.stderr}`);
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig } });
  log('test office up at', office.base);
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
      page.on('pageerror', (e) => page.errors.push(e.message));
      return page;
    };
    const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const openReady = async (page) => {
      await page.goto(`${office.base}/start`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Add project', exact: true }).first().click();
      await page.getByRole('button', { name: 'Open existing toolkit project' }).click();
      await page.waitForSelector('.xr .xs-open-path');
      await page.fill('.xr .xs-open-path', dir);
      await page.getByRole('button', { name: 'Check folder' }).click();
      await page.waitForSelector('.xr-card', { timeout: 60000 });
      await page.waitForTimeout(400);
    };

    const before = stamp(dir);
    const statusBefore = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    const page = await newPage({ width: 1440, height: 1000 }, 'portal-light');
    await openReady(page);
    const ids = await page.$$eval('.xr-row', (rows) => rows.map((x) => `${x.dataset.id}:${x.dataset.state}`));
    check(ids.length === 9, `nine rows (${ids.join(', ')})`);
    check(ids.includes('demo:error') && ids.includes('tests:warn') && ids.includes('git:ok') && ids.includes('teamserver:warn'), 'demo users red, tests and Team Server amber, git green');
    check(/Only demo users block a Deploy/.test(await page.textContent('.xr-note')), 'the note says only demo users block a Deploy');
    check(!/github\.com/.test(await page.textContent('.xr')), 'no remote URL on the page');
    check(diff(before, stamp(dir)).length === 0 && execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }) === statusBefore, 'the check left the folder exactly as it was');
    await shot(page, '10-ready-light');
    await page.getByRole('button', { name: 'Check again' }).click();
    await page.waitForTimeout(800);
    check((await page.$$('.xr-row')).length === 9, 'Check again redraws the rows');
    // Fixes: Pin (agent-office.project.json only), seed users (a wish), budget (kept until attach).
    const pinBefore = stamp(dir);
    await page.locator('.xr-row[data-id="toolkit"] .xr-fix').click();
    await page.waitForSelector('.xr-row[data-id="toolkit"][data-state="ok"]', { timeout: 20000 });
    const pinDiff = diff(pinBefore, stamp(dir));
    check(JSON.stringify(pinDiff) === JSON.stringify(['agent-office.project.json']), `Pin wrote only agent-office.project.json (${pinDiff.join(', ')})`);
    const wishBefore = stamp(dir);
    await page.locator('.xr-row[data-id="demo"] .xr-fix').click();
    await page.waitForSelector('.xr-row[data-id="demo"] .xr-done', { timeout: 20000 });
    await page.locator('.xr-row[data-id="budget"] .xr-fix').click();
    await page.fill('.xr-row[data-id="budget"] input[type=number]', '800');
    await page.locator('.xr-row[data-id="budget"] button[type=submit]').click();
    await page.waitForSelector('.xr-row[data-id="budget"][data-state="ok"]', { timeout: 20000 });
    check(diff(wishBefore, stamp(dir)).length === 0, 'the seed users wish and the budget wrote nothing to the folder');
    check(await page.locator('.xr-row[data-id="teamserver"] .xr-fix').isDisabled(), 'Add Team Server remote is off in a test office (no Mendix account)');
    await page.waitForTimeout(3500);
    await shot(page, '10-ready-fixed');
    await page.keyboard.press('Escape');
    check(!(await page.isVisible('.xr')), 'Esc closes the readiness check');
    check(page.errors.length === 0, `no page errors (${page.errors.join(' | ')})`);
    await page.context().close();

    const dark = await newPage({ width: 1440, height: 1000 }, 'portal-dark');
    await openReady(dark);
    await shot(dark, '10-ready-dark');
    await dark.context().close();

    const narrow = await newPage({ width: 390, height: 844 }, 'portal-light');
    await openReady(narrow);
    check((await narrow.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'narrow: no sideways scrolling');
    await shot(narrow, '10-ready-narrow');
    await narrow.context().close();
  } finally {
    await browser.close();
    await office.stop();
  }
  const bad = checks.filter((c) => !c.ok);
  log(`${checks.length - bad.length}/${checks.length} checks passed; shots in ${out}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
