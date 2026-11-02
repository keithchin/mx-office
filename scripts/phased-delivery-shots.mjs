// Phased delivery, part 1, in a real, throwaway TEST office: the performance guard's fixture at scale 1 (fake
// agents only, test mode, no GitHub: GH tokens removed and an empty GH_CONFIG_DIR, no Claude), seeded by
// scripts/phased-delivery-fixture.ts with a neutral room-booking project. Checks, on the real 1D view:
//
//   - a project without phases: no phase strip on the Overview, the Progress card as before; the Roadmap says
//     "Delivered in one go"
//   - a phased project: the Overview's phase strip (the Build stage renamed, the line, a chip per phase), the
//     Roadmap's timeline (a lane per phase, today line, overlap band, checkpoint diamonds, spend badges), the
//     selected phase's exit criteria and journeys, the team's open proposal; Edit phases opens with ✕ and Esc
//     gives focus back
//   - a project at the Build Plan gate: the proposed phases editor with Approve phases and start Build
//   - Portal Light and Dark, desktop and phone widths, no sideways scrolling, no page errors
//
// and saves screenshots.
//
//   npm run build && node scripts/phased-delivery-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'phased-delivery-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'phased-delivery-1', 'shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const seed = (home, floor, extra = []) => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/phased-delivery-fixture.ts', '--home', home, '--floor', floor.id, '--dir', floor.dir, ...extra], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`seed: ${r.stderr || r.stdout}`);
  log('seeded', floor.id, r.stdout.trim().split('\n').pop());
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
  const [phased, gate] = floors;
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  let office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '1500' } });
  log('test office up at', office.base, '(no phases yet)');
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    let cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
    let newPage = async (viewport, theme) => {
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
    let at = (f, tab) => `${office.base}/lite?floor=${encodeURIComponent(f.id)}&tab=${tab}`;
    const settle = (page, ms = 1500) => page.waitForTimeout(ms);
    const noSideways = async (page, w, name) => check((await page.evaluate(() => document.documentElement.scrollWidth)) <= w, `${name}: no sideways scrolling`);

    // A project without phases first (the gate project, before it's seeded): exactly as before.
    {
      const page = await newPage({ width: 1440, height: 900 }, 'portal-light');
      await page.goto(at(gate, 'command'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pt-progress', { timeout: 30000 });
      await settle(page, 3000);
      check(await page.evaluate(() => !document.querySelector('#pt-progress.ph-phased') && !!document.querySelector('.ph-strip[hidden]')), 'no phases: the Progress card has no phase strip');
      await page.goto(at(gate, 'roadmap'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.rm-empty', { timeout: 30000 });
      check(/Delivered in one go/.test(await page.textContent('.rm-empty')), 'no phases: the Roadmap says delivered in one go');
      await page.screenshot({ path: path.join(out, 'roadmap-one-go-light.png') });
      await page.context().close();
    }
    // Seeded while the office is down (it reads a project's plan once), then up again.
    await office.stop();
    seed(home, phased);
    seed(home, gate, ['--proposed']);
    office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_RATE_MS: '1500' } });
    log('test office up again at', office.base);
    cookie = await login(office.base);
    {
      const u2 = new URL(office.base);
      const c2 = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u2.hostname, path: '/' }));
      cookies.splice(0, cookies.length, ...c2);
    }

    for (const theme of ['portal-light', 'portal-dark']) {
      const name = theme.replace('portal-', '');
      const page = await newPage({ width: 1440, height: 900 }, theme);
      // The Overview's strip.
      await page.goto(at(phased, 'command'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#pt-progress.ph-phased .ph-strip:not([hidden])', { timeout: 30000 });
      await settle(page, 1500);
      const strip = await page.textContent('.ph-strip');
      check(/Build · Bookings \(3 of 8\)/.test(strip) && /Overlaps: Requests design/.test(strip), `${name}: the strip says the phase and the overlap (${strip?.slice(0, 120)})`);
      check((await page.locator('.ph-chip').count()) === 8, `${name}: a chip per phase`);
      await page.locator('#pt-progress').screenshot({ path: path.join(out, `overview-strip-${name}.png`) });
      await page.screenshot({ path: path.join(out, `overview-${name}.png`) });
      // The Roadmap.
      await page.locator('.ph-chip').nth(2).click();
      await page.waitForSelector('.rm-tl .rm-lane[data-phase]', { timeout: 30000 });
      await settle(page, 1200);
      check((await page.locator('.rm-lane[data-phase]').count()) === 8, `${name}: a lane per phase`);
      check((await page.locator('.rm-today').count()) === 1 && (await page.locator('.rm-band').count()) === 1, `${name}: today line and the overlap band`);
      check((await page.locator('.rm-cp.ok').count()) === 2, `${name}: two passed checkpoints`);
      const detail = await page.textContent('.rm-detail');
      check(/Phase 3 · Bookings/.test(detail) && /model check 0 errors/.test(detail) && /journeys pass on main \(4\/8\)/.test(detail), `${name}: the selected phase with its exit criteria`);
      check((await page.locator('.rm-proposal').count()) === 1, `${name}: the team's open proposal`);
      await page.screenshot({ path: path.join(out, `roadmap-${name}.png`), fullPage: true });
      await page.locator('.rm-lane[data-phase="ph-4"]').click();
      await settle(page, 600);
      await page.screenshot({ path: path.join(out, `roadmap-overlap-${name}.png`), fullPage: true });
      // Edit phases: ✕, Esc and focus back.
      const editBtn = page.locator('.rm-top-acts .btn.primary');
      await editBtn.click();
      await page.waitForSelector('.rm-modal', { timeout: 10000 });
      check((await page.locator('.rm-modal .rm-etable tbody tr.locked').count()) === 2, `${name}: Edit phases locks the done phases`);
      await settle(page, 700);
      await page.screenshot({ path: path.join(out, `edit-phases-${name}.png`) });
      await page.keyboard.press('Escape');
      await settle(page, 300);
      check((await page.locator('.rm-modal').count()) === 0 && (await page.evaluate(() => document.activeElement?.textContent ?? '')).includes('Edit phases'), `${name}: Esc closes it, focus back on Edit phases`);
      await editBtn.click();
      await page.waitForSelector('.rm-modal');
      check((await page.locator('.backdrop .rm-modal button.close').count()) >= 1, `${name}: the dialog has its ✕`);
      await page.keyboard.press('Escape');
      await noSideways(page, 1440, `${name} roadmap`);
      // The Build Plan gate.
      await page.goto(at(gate, 'roadmap'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.rm-gate', { timeout: 30000 });
      await settle(page, 1200);
      await page.locator('.rm-ph[data-phase="ph-3"] .rm-exp').click();
      await settle(page, 300);
      check((await page.locator('.rm-bprow').count()) === 12, `${name}: the gate opens a phase's rows with Move to`);
      await page.locator('.rm-bprow select').last().selectOption('ph-6');
      await settle(page, 300);
      check((await page.locator('.rm-bprow.moved').count()) === 1 && /unsaved/.test(await page.textContent('.rm-gate')), `${name}: a moved row is marked unsaved`);
      await page.screenshot({ path: path.join(out, `gate-${name}.png`), fullPage: true });
      check(!page.errors.length, `${name}: no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
      await page.context().close();
    }
    // Phone widths.
    for (const theme of ['portal-light', 'portal-dark']) {
      const name = `phone-${theme.replace('portal-', '')}`;
      const page = await newPage({ width: 400, height: 860 }, theme);
      await page.goto(at(phased, 'roadmap'), { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.rm-tl .rm-lane[data-phase]', { timeout: 30000 });
      await settle(page, 1200);
      await page.screenshot({ path: path.join(out, `roadmap-${name}.png`), fullPage: true });
      await noSideways(page, 400, name);
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
