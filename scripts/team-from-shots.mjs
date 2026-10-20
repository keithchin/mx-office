// Start from a team, screenshots in a throwaway TEST office (Portal Light, 1440 px): a source project set up
// offline and given a client and two hired agents (fake agents only), then a second project through the New
// project flow with the test planner: Team & budget with Start from a team open, the copied summary with
// "Not copied", the same agents ticked, and the Move confirmation before setup starts.
//
//   npm run build && node scripts/team-from-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
//
// No GitHub (offline wizard), no real Claude (the fake agent and the test planner), GH_TOKEN/GITHUB_TOKEN removed,
// GH_CONFIG_DIR an empty folder; the office is stopped and its folder removed at the end.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, removeTestDir, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';
import { makeStubs } from './perf/journey/stubs.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'team-from-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'team-from-shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) delete process.env[k];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => (checks.push({ ok: !!ok, what }), log(ok ? '✓' : '✗', what));

async function main() {
  if (fs.existsSync(root)) {
    killProcessesUnder(root);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
  fs.mkdirSync(out, { recursive: true });
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const stubs = makeStubs(root);
  const userHome = path.join(root, 'userhome');
  fs.mkdirSync(userHome, { recursive: true });
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = { ...stubs.env, AGENT_OFFICE_PLANNER: 'fake', AGENT_OFFICE_FAKE_PLANNER_MS: '600', GH_CONFIG_DIR: ghConfig, USERPROFILE: userHome, HOME: userHome, GIT_AUTHOR_NAME: 'Shots', GIT_AUTHOR_EMAIL: 'shots@test-office.invalid', GIT_COMMITTER_NAME: 'Shots', GIT_COMMITTER_EMAIL: 'shots@test-office.invalid', FAKE_MODE: 'idle', PATH: `${stubs.bin}${sep}${process.env.PATH}` };
  const office = await startTestOffice({ home, env, agent: stubs.agent });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const get = async (p) => (await fetch(office.base + p, { headers: { cookie } })).json();
    const post = async (p, body) => {
      const r = await fetch(office.base + p, { method: 'POST', headers: { cookie, origin: office.base, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    // The source project: set up offline (Startup, Fast), then two agents hired (fake), and a client.
    const info = await get('/api/wizard/info');
    const src = await post('/api/wizard/start', { kind: 'new', owner: info.org, name: 'travel-approval', description: 'Travel requests and approvals', mendix: info.defaultMendix, entry: 'greenfield', tier: 'small', roles: ['chief-analyst', 'lead-developer'], shape: 'startup', discovery: { issue: false, queue: false, model: 'opus' }, budget: { level: 'fast', total: 420 } });
    check(src.status === 200, `the source project's setup started (${src.status} ${src.body.error ?? ''})`);
    let job;
    for (let i = 0; i < 180; i++) {
      job = await get(`/api/wizard/job?id=${encodeURIComponent(src.body.id)}`);
      if (job.status === 'done' || job.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check(job.status === 'done', `the source project is set up: ${job.status}`);
    const floor = job.floor;
    for (const role of ['lead-developer', 'chief-analyst']) {
      const r = await post('/api/roster/action', { floor, action: 'hire', role });
      check(r.status === 200, `hired the ${role} on travel-approval (fake agent): ${r.status} ${r.body.error ?? ''}`);
    }
    await post('/api/roster/action', { floor, action: 'model', role: 'lead-developer', model: 'opus' });
    const client = await post('/api/portfolios/action', { action: 'create', label: 'Acme Travel' });
    if (client.body.portfolio) await post('/api/portfolios/action', { action: 'add', portfolio: client.body.portfolio.id, floor });
    // The profiles are minted at the hires; give the office a moment to write them.
    await new Promise((r) => setTimeout(r, 1500));

    const u = new URL(office.base);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addCookies(cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' })));
    await ctx.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
      localStorage.setItem('agent-office.color-theme', 'portal-light');
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /New project/ }).first().click();
    await page.waitForSelector('.nw-start.in', { timeout: 20000 });
    await page.fill('#nw-prompt', 'Expense claims: staff submit expense claims with receipts, managers approve, finance pays. Replace the spreadsheet process at our two offices.');
    await page.click('.nw-primary');
    await page.waitForSelector('#nw-sec-questions[data-state=done]', { timeout: 30000 });
    await page.click('#nw-approve');
    const dlg = page.locator('.nw-modal button:has-text("Approve anyway")');
    if (await dlg.isVisible({ timeout: 1500 }).catch(() => false)) await dlg.click();
    await page.waitForSelector('.nw-dcard', { timeout: 30000 });
    await page.waitForSelector('.nw-tf-open', { timeout: 15000 });
    await page.click('.nw-tf-open');
    await page.waitForSelector('.nw-tf-row', { timeout: 10000 });
    await page.locator('.nw-panel[aria-label="Team and budget"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot('01-team-budget-start-from-a-team');
    const row = await page.textContent('.nw-tf-row');
    check(/travel-approval/.test(row ?? '') && /Acme Travel/.test(row ?? '') && /Startup/.test(row ?? '') && /2 members/.test(row ?? ''), `the list row: ${row?.replace(/\s+/g, ' ')}`);
    await page.click('.nw-tf-row');
    await page.waitForSelector('.nw-tf-sum');
    await page.locator('.nw-tf-sum').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot('02-copied-summary-not-copied');
    const sum = (await page.textContent('.nw-tf-sum')) ?? '';
    check(/Copies the setup of travel-approval/.test(sum) && /Not copied/.test(sum) && /Lead Developer on opus/.test(sum) && /Fast/.test(sum), 'the summary says what was copied and what was not');
    const team = (await page.textContent('.nw-team-txt')) ?? '';
    check(/Startup · Fast/.test(team), `the team card follows the copy: ${team.replace(/\s+/g, ' ').slice(0, 100)}`);
    check(!/\$420/.test(team), 'the budget amount is this project’s own, not the source’s $420');
    await page.click('.nw-tf-bring input');
    await page.waitForSelector('.nw-tf-agents ul');
    await page.locator('.nw-tf-agents').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(200);
    await shot('03-same-agents');
    // The required autonomy step (nothing preselected), then Create project: the Move confirmation first.
    await page.click('.aw-lvl[data-level="2"]');
    await page.click('#nw-create');
    await page.waitForSelector('.nw-modal:has-text("Move")', { timeout: 10000 });
    await page.waitForTimeout(300);
    await shot('04-move-confirmation');
    const modal = (await page.textContent('.nw-modal')) ?? '';
    check(/working on travel-approval/.test(modal) && /handoff note/.test(modal), 'the Move confirmation says what happens on travel-approval');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nw-modal', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.id === 'nw-create'), 'Esc closes the Move confirmation and gives focus back to Create project');
    check(await page.isVisible('.nw-plan'), 'nothing was created without the confirmation');
    // Dark, for a look.
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await page.locator('.nw-tf-sum').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await shot('05-copied-summary-dark');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    // Confirm: setup starts, recorded in the audit log.
    await page.click('#nw-create');
    await page.waitForSelector('.nw-modal:has-text("Move")');
    await page.click('.nw-modal button.primary');
    // Ready to create: the summary.
    await page.waitForSelector('#nw-create-go');
    await page.click('#nw-create-go');
    await page.waitForSelector('.nw-progress', { timeout: 15000 });
    await page.waitForTimeout(800);
    await shot('06-setup-started');
    check(true, 'confirmed: the setup started');
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
    fs.rmSync(ghConfig, { recursive: true, force: true });
    if (!process.argv.includes('--keep')) {
      killProcessesUnder(root);
      try {
        removeTestDir(root);
      } catch (e) {
        log('couldn’t remove the test office folder:', e.message);
      }
    }
  }
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
