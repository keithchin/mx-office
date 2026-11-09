// Expert mode, slice 7 (Lock in), in a real, throwaway TEST office (fake agents only, test mode, no GitHub: GH tokens
// removed and an empty GH_CONFIG_DIR, no Claude, no Team Server, no Studio Pro: test mode's stand-in opener). One
// neutral Expert-mode project ("Order Desk") on session/main, a LOCAL bare repository as origin, phases seeded by
// scripts/phased-delivery-fixture.ts (phase 3's last rows are on session/main, so a merge completes it). The checks,
// licence, demo users and data impact come from the test office's script (AGENT_OFFICE_TEST_LOCKIN, test mode only),
// rewritten between the steps. On the real Session screen:
//
//   checks running · all passed · a failure accepted by name · the data impact confirmed · merged, main pushed to the
//   local origin, session/main fast-forwarded, Close phase offered and done · the Free App publish steps (Studio Pro's
//   stand-in opened) · deploy blocked by demo users · dark mode; ✕ and Esc give focus back to Lock in
//
//   npm run build && node scripts/expert-lockin-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'expert-lockin')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'docs', 'mockups', 'expert-mode', 'build-shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};

const scriptFile = path.join(root, 'lockin-script.json');
const script = (s) => fs.writeFileSync(scriptFile, JSON.stringify(s, null, 1));

function fixture() {
  const home = path.join(root, 'office');
  const data = path.join(home, '.agent-office');
  const dir = path.join(root, 'projects', 'order-desk');
  const bare = path.join(root, 'remote', 'order-desk.git');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.dirname(bare), { recursive: true });
  const git = (...a) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.autocrlf=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Alex Lee');
  git('config', 'user.email', 'alex@example.invalid');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'README.md'), '# Order Desk docs\n');
  fs.writeFileSync(path.join(dir, 'OrderDesk.mpr'), '');
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Order Desk\n\nA neutral example app for the office\'s screenshots.\n');
  fs.writeFileSync(path.join(dir, 'PROJECT.md'), '# Order Desk\n\n## Decisions\n\n| Stage | Decision | Status | Notes |\n|---|---|---|---|\n| 0 | Entry mode: greenfield | CONFIRMED | |\n| 3 | Build in phases | CONFIRMED | |\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Order Desk: first version');
  fs.writeFileSync(path.join(data, 'floors.json'), JSON.stringify([{ id: 'order-desk', name: 'Order Desk', dir, palette: 2, addedBy: 'Alex Lee', addedAt: Date.now() - 86_400_000, mode: 'expert' }]));
  fs.mkdirSync(path.join(data, 'budget'), { recursive: true });
  fs.writeFileSync(path.join(data, 'budget', 'order-desk.json'), JSON.stringify({ ledger: { version: 1, startedAt: Date.now() - 30 * 86_400_000, days: {}, rows: [], agents: { 'w:session': { key: 'w:session', name: 'Session', role: 'Developer', kind: 'worker' } }, seen: {}, stages: [] }, settings: { autoPause: true, total: 800 }, alerts: [] }));
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/phased-delivery-fixture.ts', '--home', home, '--floor', 'order-desk', '--dir', dir], { cwd: REPO, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) log('phases not seeded:', `${r.stderr}\n${r.stdout}`.split('\n').filter((l) => /Error|fatal|error:/.test(l)).slice(0, 6).join(' | '));
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
  git('remote', 'add', 'origin', bare);
  git('push', '-q', 'origin', 'main');
  git('checkout', '-q', '-b', 'session/main');
  // The session's work since: phase 3's last rows.
  fs.writeFileSync(path.join(dir, 'docs', 'rows-21-26.md'), 'waitlist, check-in code, photos, reminders\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'Rows 21-26: waitlist, check-in code, room photos and reminders built');
  return { home, dir, bare, git };
}

async function main() {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(out, { recursive: true });
  const { home, dir, bare, git } = fixture();
  script({ checks: {}, licence: 'free', demoUsers: { on: false, count: 0 }, delayMs: 2500 });
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const office = await startTestOffice({ home, env: { GH_CONFIG_DIR: ghConfig, FAKE_MODE: 'turn', FAKE_TURN_MS: '4000', FAKE_RATE_MS: '500', AGENT_OFFICE_TEST_LOCKIN: scriptFile } });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
    const newPage = async (theme) => {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
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
    const shot = (page, name) => page.screenshot({ path: path.join(out, `40-lockin-${name}.png`) });
    const text = (page) => page.evaluate(() => document.querySelector('.xl')?.innerText ?? '');
    const openPanel = async (page) => {
      await page.waitForSelector('.xs-lockin:not([disabled])', { timeout: 60000 });
      await page.click('.xs-lockin');
      await page.waitForSelector('.xl .xl-row', { timeout: 20000 });
      await page.waitForTimeout(800);
    };
    const ranAt = (page, sha) => page.waitForFunction((short) => new RegExp(`^ran .* at ${short}`).test(document.querySelector('.xl-meta')?.textContent ?? ''), sha.slice(0, 7), { timeout: 60000 });
    const finished = (page) => page.waitForFunction(() => /^ran /.test(document.querySelector('.xl-meta')?.textContent ?? ''), null, { timeout: 60000 });

    const page = await newPage('portal-light');
    await page.goto(`${office.base}/lite?floor=order-desk&tab=session`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.xs-head', { timeout: 30000 });
    await page.waitForSelector('.xs-term .xterm', { timeout: 30000 }).catch(() => undefined);
    check(await page.isVisible('.xs-lockin'), 'Lock in is in the Session header');

    // ✕ and Esc give focus back to Lock in.
    await openPanel(page);
    check(await page.isVisible('.xl header .close'), 'the panel has a ✕ top right');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.xl', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.classList.contains('xs-lockin')), 'Esc: focus back on Lock in');
    await openPanel(page);
    await page.click('.xl header .close');
    await page.waitForSelector('.xl', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.classList.contains('xs-lockin')), '✕: focus back on Lock in');

    // 1. Checks running, then all passed.
    fs.writeFileSync(path.join(dir, 'docs', 'pending.md'), 'left uncommitted by the session\n');
    await openPanel(page);
    await page.click('.xl-primary');
    await page.waitForSelector('.xl-row[data-state="running"]', { timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('.xl-row[data-state="passed"]').length >= 2, null, { timeout: 30000 }).catch(() => undefined);
    check(/running at [0-9a-f]{7}/.test(await text(page)), 'the checks show live progress at the head');
    await shot(page, 'checks-running');
    await finished(page);
    const head1 = git('rev-parse', 'session/main');
    check(git('status', '--porcelain') === '', 'the pending change was committed before the checks');
    check((await text(page)).includes(`at ${head1.slice(0, 7)}`), `the checks ran at the head ${head1.slice(0, 7)}`);
    check(/Ready/.test(await text(page)), 'Merge to main is ready when everything passes');
    await shot(page, 'all-passed');
    await page.keyboard.press('Escape');

    // 2. The session goes on; the next Lock in finds a failing journey and a data impact.
    fs.writeFileSync(path.join(dir, 'docs', 'rows-21-26.md'), 'waitlist, check-in code, photos, reminders (renamed Booking.Note)\n');
    git('commit', '-q', '-am', 'Booking: note renamed to comment');
    script({
      checks: { 'microflow-tests': { status: 'warn', summary: 'None in this app', detail: 'allowed with a waiver; Deploy needs at least a smoke set', prompt: 'Add microflow tests for the main business rules.' }, journeys: { status: 'failed', summary: '7 of 8 passed', detail: 'Failed at this commit: J-05 Book a room (status chip shows 0)', prompt: 'Journey J-05 failed. Find out why and fix the app.' }, lint: { status: 'warn', summary: '0 errors · 1 new', detail: '1 new warning: CONV010 in Bookings.Booking_Overview' } },
      licence: 'free',
      demoUsers: { on: false, count: 0 },
      impact: { status: 'impact', lines: ['Bookings.Booking.Note renamed to Comment: stored notes may be lost'] },
      delayMs: 400,
    });
    const head2 = git('rev-parse', 'session/main');
    await openPanel(page);
    await page.click('.xl-again');
    await ranAt(page, head2);
    await page.waitForTimeout(400);
    check(/Blocked: Journeys/.test(await text(page)), 'a failure blocks the merge until accepted');
    check(await page.evaluate(() => document.querySelector('.xl-primary').disabled), 'Merge to main is off');
    await page.click('input[data-check="Journeys"]');
    await page.locator('.xl-accepts').scrollIntoViewIfNeeded();
    await shot(page, 'failure-override');
    check(await page.evaluate(() => document.querySelector('.xl-primary').disabled), 'still off until the data impact is confirmed');
    await page.click('.xl-impact-box');
    await page.locator('.xl-impact').scrollIntoViewIfNeeded();
    await shot(page, 'data-impact');
    check(!(await page.evaluate(() => document.querySelector('.xl-primary').disabled)), 'Merge to main is on once both are said');

    // 3. Merge: the receipt, pushed, session/main carries on; Close phase.
    await page.click('.xl-primary');
    await page.waitForSelector('.xl-merge .xl-badge.ok', { timeout: 60000 });
    await page.waitForFunction(() => /Pushed to Team Server/.test(document.querySelector('.xl-merge')?.textContent ?? ''), null, { timeout: 60000 }).catch(() => undefined);
    const main = git('rev-parse', 'main');
    check(git('log', '-1', '--format=%B', main).includes('Accepted by Alex Lee') || git('log', '-1', '--format=%B', main).includes('Accepted by'), 'the merge commit carries the receipt and the accepted failure');
    check(execFileSync('git', ['rev-parse', 'main'], { cwd: bare, encoding: 'utf8' }).trim() === main, 'main was pushed to the local origin');
    check(git('rev-parse', 'HEAD') === main && git('symbolic-ref', '--short', 'HEAD') === 'session/main', 'session/main fast-forwarded to the new main');
    await page.waitForSelector('.xl-close-phase', { timeout: 20000 }).catch(() => undefined);
    check(await page.isVisible('.xl-close-phase'), 'Close phase is offered: every row of the phase is done');
    await page.locator('.xl-phase').scrollIntoViewIfNeeded();
    await shot(page, 'merged-phase-close');
    if (await page.isVisible('.xl-close-phase')) {
      await page.click('.xl-close-phase');
      await page.waitForSelector('.xl-phase.done', { timeout: 20000 }).catch(() => undefined);
      check(await page.isVisible('.xl-phase.done'), 'the phase is closed');
    }

    // 4. Free App: Studio Pro (test mode's stand-in) opens on the merged main; the steps.
    await page.locator('.xl-publish-card').scrollIntoViewIfNeeded();
    await page.click('.xl-publish');
    await page.waitForTimeout(1200);
    check(/Press Run once[\s\S]*Then press Publish/.test(await text(page)), 'the Free App steps: Run, then Publish');
    await shot(page, 'free-app-publish');
    await page.keyboard.press('Escape');
    const proof = await page.textContent('.xs-proof');
    check(/Decisions\s*\d+/.test(proof?.replace(/\s+/g, ' ') ?? '') , `the proof strip counts the decisions (${proof?.replace(/\s+/g, ' ').match(/Decisions\s*\d+/)?.[0]})`);

    // 5. A licensed app with demo users on: Deploy blocked, the reason and the fix.
    script({ checks: {}, licence: 'licensed', demoUsers: { on: true, count: 6 }, delayMs: 400 });
    await openPanel(page);
    await page.locator('.xl-deploy-card').scrollIntoViewIfNeeded();
    check(/Demo users are on \(6\): they block Deploy/.test(await text(page)), 'Deploy is blocked by demo users, with the reason');
    await shot(page, 'deploy-blocked');
    await page.keyboard.press('Escape');
    check(!page.errors.length, `no page errors${page.errors.length ? `: ${page.errors.join(' | ')}` : ''}`);
    await page.context().close();

    // 6. Dark: a fresh run with one failure.
    script({ checks: { journeys: { status: 'failed', summary: '7 of 8 passed', detail: 'Failed at this commit: J-05 Book a room' } }, licence: 'free', demoUsers: { on: true, count: 6 }, delayMs: 300 });
    fs.writeFileSync(path.join(dir, 'docs', 'more.md'), 'more work\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'Requests: form started');
    const dark = await newPage('portal-dark');
    await dark.goto(`${office.base}/lite?floor=order-desk&tab=session`, { waitUntil: 'domcontentloaded' });
    await dark.waitForSelector('.xs-head', { timeout: 30000 });
    await openPanel(dark);
    await dark.click('.xl-again, .xl-primary');
    await ranAt(dark, git('rev-parse', 'session/main'));
    await dark.waitForTimeout(500);
    await shot(dark, 'dark');
    check(!dark.errors.length, `dark: no page errors${dark.errors.length ? `: ${dark.errors.join(' | ')}` : ''}`);
    await dark.context().close();
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
