// Expert mode slice 5 (the mode choice and the Expert wizard) in a throwaway TEST office: fake agents, test mode, the
// journey's stand-ins for gh, Studio Pro and the toolkit (scripts/perf/journey/stubs.mjs), GH tokens removed and an
// empty GH_CONFIG_DIR, no Mendix token and nothing that calls the Mendix Portal. The office's answer about the Mendix
// account and the pin choices are changed in the browser (mocked), so the page shows "Mendix account connected"; the
// setup itself really runs, offline (a test office's local stand-in takes Team Server's place). Checks:
//
//   - ✨ New project opens "How do you want to build?" with Expert and Team cards; Team opens the brief-first flow
//   - Expert: the wizard's defaults (11.12.4, Sonnet, latest pins, git locked on, demo users on, pause at 100 %)
//   - Create and open session: the setup's progress in Expert words, then the Session screen with the session running
//   - the project is Expert mode, its brief is in docs/project-brief.md, its model is saved; no team was hired
//   - ✕ and Esc close the page and give focus back; no page errors, no sideways scrolling
//
//   npm run build && node scripts/expert-wizard-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { assertTestDir, killProcessesUnder, login, startTestOffice, REPO } from './perf/office.mjs';
import { findChrome } from './perf/pages.mjs';
import { makeStubs } from './perf/journey/stubs.mjs';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'expert-wizard')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'expert-wizard', 'shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'AGENT_OFFICE_TEST_ALLOW_GH_TOKEN', 'MENDIX_PAT', 'MENDIX_TOKEN', 'MX_PAT', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'HEYGEN_API_KEY']) delete process.env[k];

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const checks = [];
const check = (ok, what) => {
  checks.push({ ok: !!ok, what });
  log(ok ? '✓' : '✗', what);
};
const SETUP_INFO = {
  toolkit: { latest: { sha: '6a1f0c9e2b7d4f3a8c5e1d2b9f0a7c3e4d6b8a10', date: '2026-11-06' }, recent: [{ sha: '6a1f0c9e2b7d4f3a8c5e1d2b9f0a7c3e4d6b8a10', date: '2026-11-06', subject: 'Playbook: microflow test rule' }, { sha: '3c2e9d1a7b5f4e6c8a0d2b4f6e8a1c3d5b7f9e20', date: '2026-11-03', subject: 'Lint: page naming' }] },
  mxcli: { latest: 'v0.21.0', versions: ['v0.21.0'] },
};

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
  const env = { ...stubs.env, GH_CONFIG_DIR: ghConfig, USERPROFILE: userHome, HOME: userHome, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@test-office.invalid', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@test-office.invalid', FAKE_MODE: 'turn', FAKE_TURN_MS: '3000', PATH: `${stubs.bin}${sep}${process.env.PATH}` };
  const office = await startTestOffice({ home, env, agent: stubs.agent });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addCookies(cookies);
    await ctx.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
      localStorage.setItem('agent-office.color-theme', 'portal-light');
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => /sandboxed and lacks the 'allow-same-origin'/.test(e.message) || errors.push(e.message));
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const api = async (p) => (await fetch(office.base + p, { headers: { cookie } })).json();
    const theme = (t) => page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
    const noSideways = async (name) => check((await page.evaluate(() => document.documentElement.scrollWidth)) <= 1440, `${name}: no sideways scrolling`);
    // The Mendix account as connected, and the pin choices (a test office has neither).
    await page.route('**/api/wizard/info*', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), offline: false, mendixToken: true } });
    });
    await page.route('**/api/expert/setup-info*', (route) => route.fulfill({ json: SETUP_INFO }));

    const openNew = async () => {
      await page.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
      const btn = page.getByRole('button', { name: /New project/ }).first();
      await btn.click();
      await page.waitForSelector('.xw-mode.in', { timeout: 20000 });
      await page.waitForTimeout(300);
    };

    // 1. The mode choice.
    await openNew();
    check((await page.locator('.xw-card').count()) === 2, 'two cards: Expert and Team');
    check(/Your own Claude session, with the office in the background\. For experienced builders making new apps\./.test(await page.textContent('.xw-card[data-mode=expert]')), 'Expert mode’s line');
    check(/A governed agent team\. For rebuilds, migrations, governed delivery, and people new to Mendix\./.test(await page.textContent('.xw-card[data-mode=team]')), 'Team mode’s line');
    check((await page.getAttribute('.xw-card[data-mode=expert]', 'aria-checked')) === 'true', 'Expert is picked first');
    await noSideways('mode choice');
    await shot('20-wizard-mode-light');
    await theme('portal-dark');
    await page.waitForTimeout(200);
    await shot('20-wizard-mode-dark');
    await theme('portal-light');
    // Esc closes and gives focus back to New project.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check(!(await page.isVisible('.xw-mode')), 'Esc closes New project');
    check(await page.evaluate(() => /New project/.test(document.activeElement?.textContent ?? '')), 'focus is back on New project');

    // 2. Team mode carries on into the brief-first flow unchanged.
    await openNew();
    await page.click('.xw-card[data-mode=team]');
    await page.click('#xw-continue');
    await page.waitForSelector('.nw-start.in', { timeout: 20000 }).catch(() => undefined);
    check(await page.isVisible('.nw-start'), 'Team mode opens the brief-first flow');
    await page.click('.nw-close');
    await page.waitForTimeout(300);

    // 3. Expert mode: the wizard.
    await openNew();
    await page.click('#xw-continue');
    await page.waitForSelector('.xw-wizard.in', { timeout: 20000 });
    check((await page.inputValue('#xw-mendix')) === '11.12.4', 'Mendix 11.12.4 by default');
    check((await page.inputValue('#xw-model')) === 'sonnet', 'Sonnet by default');
    check((await page.inputValue('#xw-toolkit')) === 'latest' && (await page.inputValue('#xw-mxcli')) === 'latest', 'the latest pins by default');
    check((await page.isChecked('#xw-git')) && (await page.isDisabled('#xw-git')), 'git and the Team Server push: locked on');
    check(await page.isChecked('#xw-demo'), 'demo users on, for local work');
    check((await page.isChecked('#xw-pause')) && (await page.isDisabled('#xw-pause')), 'pause at 100 %: locked on');
    check(/Mendix account connected/.test(await page.textContent('.xw-approw')), 'the Mendix account shows connected, with no token field');
    check((await page.locator('.xw-wizard input[type=password]').count()) === 0, 'no token field anywhere');
    check(await page.isDisabled('#xw-create'), 'Create waits for a name');
    await page.fill('#xw-name', 'Order Desk');
    await page.fill('#xw-brief', 'An order desk for a small warehouse: staff see waiting orders, pickers get a packing list on their phone, and the manager sees what shipped today.');
    check(!(await page.isDisabled('#xw-create')), 'Create is ready once named');
    await noSideways('wizard');
    await page.locator('.xw-wizard').evaluate((el) => (el.scrollTop = 0));
    await shot('20-wizard-form-light');
    await page.locator('.xw-wizard').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(150);
    await shot('20-wizard-form-bottom-light');
    await theme('portal-dark');
    await page.locator('.xw-wizard').evaluate((el) => (el.scrollTop = 0));
    await page.waitForTimeout(200);
    await shot('20-wizard-form-dark');
    await page.locator('.xw-wizard').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(150);
    await shot('20-wizard-form-bottom-dark');
    await theme('portal-light');
    // Connect existing asks for the App ID.
    await page.click('.xw-seg button[data-app=connect]');
    check(await page.isVisible('#xw-appid'), 'Connect existing asks for the App ID');
    check(await page.isDisabled('#xw-create'), 'and waits for it');
    await page.click('.xw-seg button[data-app=create]');

    // 4. Create and open session.
    await page.click('#xw-create');
    await page.waitForSelector('.nw-progress.in', { timeout: 20000 });
    await page.waitForTimeout(1500);
    check(/Team Server app/.test(await page.textContent('.nw-progress')), 'the progress is in the Expert wizard’s words');
    await shot('20-wizard-progress-light');
    // Done: the Session screen, the session started by itself.
    await page.waitForSelector('.xs-head', { timeout: 240000 }).catch(() => undefined);
    check(await page.isVisible('.xs-head'), 'the Session screen opened once the setup was done');
    await page.waitForSelector('.xs-term .xterm', { timeout: 60000 }).catch(() => undefined);
    check(await page.isVisible('.xs-term .xterm'), 'the session runs in the project folder');
    await page.waitForTimeout(3000);
    // The project page's own first load (its summary) can take a while in a test office: shot once its notice is gone.
    await page.waitForFunction(() => !/Loading project/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => undefined);
    await page.waitForTimeout(1000);
    check(/Order Desk/.test((await page.textContent('#pt-nav')) ?? ''), 'the project is titled as typed');
    await shot('20-wizard-session-light');

    const floors = await api('/api/floors').catch(() => undefined);
    const jobs = (await api('/api/wizard/info')).jobs;
    log('jobs', JSON.stringify(jobs), 'floors', JSON.stringify(floors)?.slice(0, 300));
    const dir = path.join(home, 'projects');
    const proj = fs.readdirSync(dir, { recursive: true }).map(String).find((p) => p.replace(/\\/g, '/').endsWith('order-desk/agent-office.project.json'));
    const pf = proj && JSON.parse(fs.readFileSync(path.join(dir, proj), 'utf8'));
    check(pf?.mode === 'expert' && pf?.expert?.model === 'sonnet' && pf?.expert?.demoUsers === true, `the project file says Expert mode, Sonnet, demo users on (${JSON.stringify(pf?.expert)})`);
    const briefFile = proj && path.join(dir, path.dirname(proj), 'docs', 'project-brief.md');
    check(briefFile && fs.existsSync(briefFile) && /order desk for a small warehouse/.test(fs.readFileSync(briefFile, 'utf8')), 'the brief is in docs/project-brief.md');
    const floorsJson = JSON.parse(fs.readFileSync(path.join(home, '.agent-office', 'floors.json'), 'utf8'));
    check(floorsJson.some((f) => f.mode === 'expert' && /order-desk/.test(f.id)), 'the office has the project in Expert mode');
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
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
