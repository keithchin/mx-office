// Screenshots of Mendix Team Server in a throwaway TEST office (test planner, fake agents, offline wizard, no GitHub,
// no Mendix: a test office holds no tokens, and nothing here calls the Portal): the New project flow's Where the code
// lives (as the test office has it, and with the office's answer changed in the browser to "a Mendix token is
// there" so the enabled choices show), a local-only project made through the flow, its ⚙️ Settings › ☁️ Team Server
// (no token; with a token, the Connect confirm step; connected, with the page's answer changed in the browser), and
// 🔌 Connections › Folders with the mxcli row. Esc and ✕ on the confirm step give focus back to the button.
//
//   npm run build && node scripts/team-server-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'team-server-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'team-server-shots')));
assertTestDir(root);
// Nothing of the machine's own sign-ins reaches the test office (it would withhold them anyway).
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR', 'MENDIX_PAT', 'MENDIX_TOKEN', 'MX_PAT']) delete process.env[k];

const APP_ID = '1a2b3c4d-1111-2222-3333-444455556666';
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
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { recursive: true });
  const stubs = makeStubs(root);
  const userHome = path.join(root, 'userhome');
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  fs.mkdirSync(userHome, { recursive: true });
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = { ...stubs.env, AGENT_OFFICE_PLANNER: 'fake', AGENT_OFFICE_FAKE_PLANNER_MS: '800', GH_CONFIG_DIR: ghConfig, USERPROFILE: userHome, HOME: userHome, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@test-office.invalid', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@test-office.invalid', FAKE_MODE: 'turn', FAKE_TURN_MS: '3000', PATH: `${stubs.bin}${sep}${process.env.PATH}` };
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
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });
    const api = async (p) => (await fetch(office.base + p, { headers: { cookie } })).json();
    const both = async (name, sel, block = 'center') => {
      for (const t of ['portal-light', 'portal-dark']) {
        await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
        await page.waitForTimeout(200);
        if (sel) await page.locator(sel).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
        await page.waitForTimeout(150);
        await shot(`${name}-${t.replace('portal-', '')}`);
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    };
    const toAdvanced = async () => {
      await page.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /New project/ }).first().click();
      const resume = await page.waitForSelector('.nw-resume', { timeout: 4000 }).catch(() => null);
      if (resume) await page.click('.nw-resume button:has-text("Continue")');
      else {
        await page.waitForSelector('.nw-start.in', { timeout: 20000 });
        await page.fill('#nw-prompt', 'Visitor Registration: an office visitor sign-in app. Visitors sign in at reception, their host approves, and reception prints a badge.');
        await page.click('.nw-primary');
        await page.waitForSelector('#nw-sec-questions[data-state=done]', { timeout: 20000 });
        await page.click('#nw-approve');
        const dlg = await page.waitForSelector('.nw-modal:has-text("Approve anyway")', { timeout: 3000 }).catch(() => null);
        if (dlg) await page.click('.nw-modal button:has-text("Approve anyway")');
      }
      await page.waitForSelector('.nw-dcard', { timeout: 20000 });
      if ((await page.getAttribute('.nw-adv-h', 'aria-expanded')) !== 'true') await page.click('.nw-adv-h');
      await page.waitForSelector('.nw-home');
      await page.waitForTimeout(300);
    };

    // 1. The test office as it is: no Mendix token, offline: the Team Server choices say why, GitHub (offline) is the default.
    await toAdvanced();
    check((await page.getAttribute('#nw-home-teamserver', 'disabled')) !== null, 'Team Server is unavailable without a Mendix token');
    check(/Unavailable: .*(Mendix token|offline test office)/.test((await page.textContent('.nw-home-opt[data-home="teamserver"]')) ?? ''), 'and says why');
    check(await page.isChecked('#nw-home-github'), 'GitHub is the default without a Mendix token');
    await both('01-wizard-where-no-token', '.nw-home');

    // 2. Local only, made through the flow (offline), for the Settings shots.
    await page.click('#nw-home-local');
    check(await page.isChecked('#nw-home-local'), 'Local only picked by hand');
    await page.click('.aw-lvl[data-level="2"]');
    await page.click('#nw-create');
    await page.waitForSelector('#nw-create-go');
    check(/Local only/.test((await page.textContent('.aw-sum')) ?? ''), 'the summary says where the code lives');
    await page.waitForTimeout(200);
    await shot('02-summary-local-light');
    await page.click('#nw-create-go');
    let job;
    for (let i = 0; i < 240; i++) {
      const id = (await api('/api/wizard/info')).jobs[0]?.id ?? job?.id ?? 'test-org__visitor-registration';
      job = (await api(`/api/wizard/job?id=${encodeURIComponent(id)}`).catch(() => undefined)) ?? job;
      if (job && (job.status === 'done' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check(job?.status === 'done', `the local-only setup finished: ${job?.status}`);

    // 3. With the office's answer changed in the browser (a Mendix token and a GitHub token are there): the choices enabled, Team Server the default.
    await page.route('**/api/wizard/info*', async (route) => {
      const res = await route.fetch();
      const info = await res.json();
      await route.fulfill({ response: res, json: { ...info, offline: false, mendixToken: true, adminToken: { ...info.adminToken, configured: true }, claudeSignIn: { ready: false, why: 'Sign in to Claude first (☰ → 🔐 Your sign-ins): your workers run on your own Claude plan', office: true } } });
    });
    await toAdvanced();
    check(await page.isChecked('#nw-home-teamserver'), 'with a Mendix token, Team Server is the default');
    check(!!(await page.$('#nw-a-appid')), 'a Team Server choice takes an existing App ID');
    await both('03-wizard-where-teamserver', '.nw-home');
    await page.click('#nw-home-teamserver-github');
    await page.waitForTimeout(150);
    await shot('04-wizard-where-mirror-light');
    // Ready to create with that answer: the code's home, the total budget field, and no Claude sign-in yet (Create waits).
    await page.click('#nw-home-teamserver');
    await page.click('.aw-lvl[data-level="2"]');
    await page.click('#nw-create');
    await page.waitForSelector('#nw-create-go');
    await page.waitForTimeout(300);
    const sum = (await page.textContent('.aw-sum')) ?? '';
    check(/Mendix Team Server/.test(sum) && /Creates the app in the Mendix Portal/.test(sum), 'Ready to create says the code goes to Team Server');
    check(/Sign in to Claude: ☰ → 🔐 Your sign-ins/.test(sum), 'and that the Claude sign-in is missing, with the fix');
    check(await page.isDisabled('#nw-create-go'), 'Create waits for the sign-in');
    check(!!(await page.$('#nw-sum-total')), 'a total budget field');
    await page.fill('#nw-sum-total', '1800');
    await page.locator('#nw-sum-total').dispatchEvent('change');
    check(/Budget \$1,800/.test((await page.textContent('.aw-sum')) ?? ''), 'the total typed is the budget');
    await both('09-summary-teamserver-signin', null);
    await page.keyboard.press('Escape');
    await page.unroute('**/api/wizard/info*');
    await page.click('.nw-close').catch(() => {});

    // 4. ⚙️ Settings › ☁️ Team Server for the local-only project: no token in a test office.
    const floor = job.floor;
    const settings = `${office.base}/lite?floor=${encodeURIComponent(floor)}&tab=settings&section=teamserver`;
    await page.goto(settings, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ts-connect', { timeout: 20000 });
    check(await page.isDisabled('#ts-connect'), 'Connect waits for a Mendix token');
    await both('05-settings-connect-no-token', '.ts-card');

    // 5. A token there (the page's answer changed in the browser): Connect, its confirm step, Esc and ✕ give focus back.
    await page.route('**/api/team-server?*', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), token: true } });
    });
    await page.goto(settings, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ts-connect:not([disabled])', { timeout: 20000 });
    await page.click('#ts-connect');
    await page.waitForSelector('.ts-confirm');
    check(/Creates a new app in the Mendix Portal/.test((await page.textContent('.ts-confirm')) ?? ''), 'the confirm step says it creates an app in the Portal');
    check(/pushes the project’s main there/.test((await page.textContent('.ts-confirm')) ?? ''), 'and that it pushes the code');
    check(!!(await page.$('.ts-confirm .close')), 'the confirm step has a ✕');
    await page.waitForTimeout(200);
    await both('06-connect-confirm', null);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(!(await page.$('.ts-confirm')) && (await page.evaluate(() => document.activeElement?.id)) === 'ts-connect', 'Esc closes it and gives focus back to Connect');
    await page.click('#ts-connect');
    await page.waitForSelector('.ts-confirm');
    await page.click('.ts-confirm .close');
    await page.waitForTimeout(150);
    check((await page.evaluate(() => document.activeElement?.id)) === 'ts-connect', '✕ gives focus back to Connect');
    await page.unroute('**/api/team-server?*');

    // 6. Connected (the page's answer changed in the browser: a neutral example app).
    await page.route('**/api/team-server?*', (route) =>
      route.fulfill({
        json: {
          floor,
          record: { projectId: APP_ID, url: `https://git.api.mendix.com/${APP_ID}.git`, remote: 'teamserver', how: 'made', by: 'Alex Lee', at: Date.now() - 3_600_000 },
          portalUrl: `https://sprintr.home.mendix.com/link/project/${APP_ID}`,
          last: { at: Date.now() - 120_000, state: 'pushed', sha: '7b4b4cf13b9f', message: 'Pushed main (7b4b4cf) to Team Server (it was at 1c2d3e4).' },
          running: false,
          token: true,
          localOnly: true,
          may: true,
        },
      }),
    );
    await page.goto(settings, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ts-push', { timeout: 20000 });
    await both('07-settings-connected', '.ts-card');
    await page.unroute('**/api/team-server?*');

    // 7. 🔌 Connections › Folders › mxcli.
    await page.goto(`${office.base}/lite?floor=${encodeURIComponent(floor)}&tab=settings&section=connections`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#cx-path-mxcli', { timeout: 20000 });
    check(/mxcli/.test((await page.textContent('#cx-path-mxcli')) ?? ''), 'Connections › Folders has an mxcli row');
    await both('08-connections-folders-mxcli', '#cx-paths');

    errors.splice(0, errors.length, ...errors.filter((e) => !/sandboxed and lacks the 'allow-same-origin'/.test(e)));
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
    await office.stop().catch((e) => log('stop:', e.message));
    fs.rmSync(ghConfig, { recursive: true, force: true });
  }
  const failed = checks.filter((c) => !c.ok);
  log(`${checks.length - failed.length}/${checks.length} checks passed; screenshots in ${out}`);
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
