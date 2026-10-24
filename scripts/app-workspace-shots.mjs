// The App Workspace (C3, C4, C5) in a real, throwaway TEST office: the performance guard's fixture at scale 1 (fake
// agents only, test mode, no GitHub: GH tokens removed and an empty GH_CONFIG_DIR, no Claude). Checks the
// route and the switch end to end and takes Portal Light, Dark and phone screenshots:
//
//   - /lite?floor=<p>&ws=app opens the App Workspace (its App section), the Engineering chrome out of the way
//   - Developer → Project Management keeps the project (no reload) and lands on the Live app page; back again
//     through the navigation's Developer, the switch returns to the page you came from
//   - every old deep link (?tab=board, ?tab=agents, ?tab=live) opens as before, with no workspace
//   - ?ws=eng&tab=decisions opens Approvals; ?tab=decisions the Decisions section; a reload keeps the section
//   - C4: Request a change sends a request that comes back with a task id (or the office's refusal, said in the
//     dialog), shown in the panel and under Decisions
//   - C5: Review with no version on screen, the guided-validation route at main (a mark refused with no app),
//     Release and Accept through the existing acceptance path (its answer, a refusal in business words)
//
//   npm run build && node scripts/app-workspace-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'app-workspace-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'app-workspace-shots')));
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
    const newPage = async (viewport) => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookies);
      await ctx.addInitScript(() => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', 'portal-light');
      });
      const page = await ctx.newPage();
      page.errors = [];
      // The Live app tab's frame's own sandbox complaint (every page of a test office has it) is not the workspace's.
      page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || page.errors.push(e.message));
      return page;
    };
    const base = `${office.base}/lite?floor=${encodeURIComponent(floor)}`;
    const q = (page) => new URL(page.url()).searchParams;
    const both = async (page, name, full = false) => {
      for (const t of ['portal-light', 'portal-dark']) {
        await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, `${name}-${t.replace('portal-', '')}.png`), fullPage: full });
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    };

    const page = await newPage({ width: 1440, height: 900 });
    await page.goto(`${base}&ws=app`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .aw-side [data-part="status"]', { timeout: 30000 });
    await page.waitForFunction(() => !/Reading the brief/.test(document.querySelector('.aw')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
    check(await page.evaluate(() => document.body.classList.contains('aw-on')), 'ws=app: the App Workspace is the page');
    check(q(page).get('tab') === 'app' && q(page).get('ws') === 'app' && q(page).get('floor') === floor, `the address says so: ${page.url()}`);
    check(await page.evaluate(() => getComputedStyle(document.getElementById('pt-nav') ?? document.body).display === 'none'), 'the Engineering navigation steps aside');
    check(/Developer view/.test((await page.textContent('.aw-crumb')) ?? ''), 'the bar names the project and the workspace');
    await both(page, 'c3-10-office-app');
    for (const s of ['requirements', 'decisions', 'review', 'release']) {
      await page.click(`.aw-tab[data-section="${s}"]`);
      await page.waitForTimeout(400);
      check(q(page).get('tab') === s && q(page).get('ws') === 'app', `section ${s} in the address`);
    }
    await both(page, 'c3-11-office-release');
    // A reload keeps the section.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .aw-tab.on[data-section="release"]', { timeout: 30000 });
    check(true, 'a reload keeps the section (Release)');

    // The switch: the project kept, no reload, the closest Engineering page.
    await page.click('.aw-tab[data-section="app"]');
    await page.evaluate(() => (window.__noReload = true));
    await page.click('.vs-seg[data-view="eng"]');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => window.__noReload === true), 'the switch doesn’t reload the page');
    check(q(page).get('tab') === 'live' && !q(page).get('ws') && q(page).get('floor') === floor, `App → Engineering: Live app, same project: ${page.url()}`);
    check(await page.isHidden('.aw'), 'the workspace stepped aside');
    check(await page.evaluate(() => !document.body.classList.contains('aw-on')), 'the Engineering chrome is back');
    // From the Board, through the navigation's App workspace, and back to the Board.
    await page.$eval('#pt-nav [data-nav="board"]', (el) => el.click());
    await page.waitForTimeout(400);
    await page.$eval('#pt-nav [data-nav="app"]', (el) => el.click());
    await page.waitForSelector('.aw:not([hidden])');
    check(q(page).get('tab') === 'app' && q(page).get('ws') === 'app', 'the navigation’s App workspace opens it');
    await page.click('.vs-seg[data-view="eng"]');
    await page.waitForTimeout(400);
    check(q(page).get('tab') === 'board', `Engineering view returns to the page you came from: ${q(page).get('tab')}`);
    check(await page.evaluate(() => window.__noReload === true), 'still the same page');

    // Old deep links: exactly as before.
    for (const [asked, is] of [['board', 'board'], ['agents', 'workers'], ['live', 'live'], ['approvals', 'approvals']]) {
      await page.goto(`${base}&tab=${asked}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      check(q(page).get('tab') === is && !(await page.evaluate(() => document.body.classList.contains('aw-on'))), `?tab=${asked} opens ${is}, no workspace`);
    }
    await page.goto(`${base}&ws=eng&tab=decisions`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    check(q(page).get('tab') === 'approvals', '?ws=eng&tab=decisions opens Approvals');
    await page.goto(`${base}&tab=decisions`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.aw:not([hidden]) .aw-tab.on[data-section="decisions"]', { timeout: 30000 });
    await page.waitForTimeout(1500);
    check(true, '?tab=decisions opens the Decisions section');
    await both(page, 'c3-12-office-decisions');

    // C4: Request a change in the real office: a task minted for the team lead, its state shown in business words.
    await page.click('.aw-tab[data-section="app"]');
    await page.waitForSelector('[data-part="request"] .aw-ask', { timeout: 30000 });
    await page.click('[data-part="request"] .aw-ask');
    await page.waitForSelector('.aw-reqdlg');
    await page.fill('.aw-reqtext', 'Show the host’s name on the printed badge, next to the visitor’s name.');
    await page.waitForTimeout(400);
    await both(page, 'c4-20-office-request-dialog');
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => !document.querySelector('.aw-reqdlg') || /\S/.test(document.querySelector('.aw-reqdlg [role="alert"]')?.textContent ?? ''), null, { timeout: 30000 });
    const refused = await page.evaluate(() => (document.querySelector('.aw-reqdlg') ? document.querySelector('.aw-reqdlg [role="alert"]')?.textContent : null));
    if (refused) {
      check(true, `the office refused the request, said in the dialog: ${refused}`);
      await page.keyboard.press('Escape');
    } else {
      const list = await page.evaluate(async (f) => (await (await fetch(`/api/change-requests?floor=${encodeURIComponent(f)}`)).json()).requests, floor);
      check(list.length === 1 && /^tsk_/.test(list[0].taskId), `the request has a task id: ${list[0]?.id} ${list[0]?.taskId} for ${list[0]?.member}, ${list[0]?.words}`);
      await page.waitForFunction(() => document.querySelector('[data-part="request"] .aw-pill'), null, { timeout: 30000 });
      check(true, `the panel shows it: ${await page.textContent('[data-part="request"] .aw-pill')}`);
    }
    await page.waitForTimeout(800);
    await both(page, 'c4-21-office-app-request');
    await page.click('.aw-tab[data-section="decisions"]');
    await page.waitForTimeout(800);
    await both(page, 'c4-22-office-decisions', true);
    // C5: guided validation and accept in the real office (no app runs in a test office: nothing to mark).
    await page.click('.aw-tab[data-section="review"]');
    await page.waitForSelector('.aw-guided', { timeout: 30000 });
    check(/No version is running in the app right now/.test((await page.textContent('.aw-guided')) ?? ''), 'Review: no version on screen, nothing to try, said so');
    const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: floors[0].dir, encoding: 'utf8', windowsHide: true }).stdout?.trim();
    if (head) {
      const gv = await page.evaluate(async ([f, r]) => (await fetch(`/api/guided-validation?floor=${encodeURIComponent(f)}&revision=${r}`)).json(), [floor, head]);
      check(Array.isArray(gv.scenarios) && gv.revision === head, `GET /api/guided-validation at ${head.slice(0, 7)}: ${gv.scenarios?.length} checks, results at that version only`);
      const mark = await page.evaluate(async ([f, r]) => {
        const res = await fetch('/api/guided-validation/mark', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ floor: f, revision: r, scenario: 'x', verdict: 'works' }) });
        return { status: res.status, body: await res.json() };
      }, [floor, head]);
      check(mark.status === 409, `a mark with no app running is refused: ${mark.status} ${mark.body.error}`);
    }
    await both(page, 'c5-20-office-review', true);
    await page.click('.aw-tab[data-section="release"]');
    await page.waitForSelector('.aw-acceptcard', { timeout: 30000 });
    await page.waitForFunction(() => !/Reading what would be recorded/.test(document.querySelector('.aw-acceptcard')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
    await both(page, 'c5-21-office-release', true);
    if (await page.$('.aw-accept:not([disabled])')) {
      await page.click('.aw-accept');
      await page.waitForSelector('.aw-accdlg .aw-confirm', { timeout: 60000 });
      await page.check('.aw-accdlg .aw-confirm');
      await page.click('.aw-acceptgo');
      await page.waitForFunction(() => !document.querySelector('.aw-accdlg') || !document.querySelector('.aw-accdlg .aw-refusal')?.hidden, null, { timeout: 60000 });
      const said = await page.evaluate(() => (document.querySelector('.aw-accdlg') ? document.querySelector('.aw-accdlg .aw-refusal')?.textContent : null));
      check(true, said ? `Accept through the existing path: refused, said as “${said}”` : 'Accept through the existing path: accepted');
      if (said) {
        await page.waitForTimeout(300);
        await both(page, 'c5-22-office-accept-refused');
        await page.keyboard.press('Escape');
      }
    }
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);

    // A phone.
    const phone = await newPage({ width: 400, height: 860 });
    await phone.goto(`${base}&ws=app`, { waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('.aw:not([hidden]) .aw-side [data-part="status"]', { timeout: 30000 });
    await phone.waitForTimeout(2500);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    check(w <= 400, `phone: no sideways scrolling (${w})`);
    await both(phone, 'c3-13-office-phone', true);
    check(!phone.errors.length, `phone: no page errors${phone.errors.length ? `: ${phone.errors.join(' | ')}` : ''}`);
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
