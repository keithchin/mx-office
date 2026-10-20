// Screenshots of the New project flow's autonomy step in a throwaway TEST office (test planner, fake agents,
// offline wizard, no GitHub, no Claude): the step empty and picked, limited and fixed by the office's policy
// (with the acknowledgement), the summary before Create, and Settings › Team saying who chose the level and
// when, in Portal Light and Dark. GH_TOKEN/GITHUB_TOKEN removed, GH_CONFIG_DIR an empty folder.
//
//   npm run build && node scripts/autonomy-step-shots.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'autonomy-step-shots')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'autonomy-step-shots')));
assertTestDir(root);
for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GH_CONFIG_DIR']) delete process.env[k];

// The toolkit's eleven kickoff questions (headings as bin/lib/intake-template.sh has them), for the stub toolkit.
const INTAKE = ['# intake.md — Stage P Kickoff Interview', '', ...[
  '1. Entry mode: migration, requirements-driven, greenfield, or change an existing app?',
  '2. What is this project, and what is driving it?',
  '3. Fidelity: port as-is, or improve as we go?',
  '4. What are we working on: the whole application, or a part of it — and what else does that touch?',
  '5. Of what we touch, what must stay exactly as it is?',
  '6. Are there licence/security constraints on storing this client\'s source in this workspace?',
  '7. Is an SME available — who, and at what cadence?',
  '8. Anything else — scope, priorities, or worries?',
  '9. Interview mode: attended (default) or unattended?',
  '10. Is any of this already done outside the toolkit — and where does the pipeline pick up?',
  '11. Exec approval: `auto` (default) or `ask`?',
].flatMap((q) => [`## ${q}`, '', '_Not yet asked._ Guidance for the question.', ''])].join('\n');

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
  // The stub toolkit, with the real eleven questions.
  const tk = path.join(root, 'stubs', 'toolkit', 'bin');
  fs.writeFileSync(path.join(tk, 'lib', 'intake-template.sh'), `cat <<'MXTK_INTAKE_EOF'\n${INTAKE}\nMXTK_INTAKE_EOF\n`);
  const init = fs.readFileSync(path.join(tk, 'init-project.sh'), 'utf8').replace(/echo '[A-Za-z0-9+/=]+' \| base64 -d > "\$d\/intake.md"/, `echo '${Buffer.from(INTAKE).toString('base64')}' | base64 -d > "$d/intake.md"`);
  // PROJECT.md with the sections the toolkit's init-project.sh writes after Decisions (Open questions, Assumptions).
  const register = ['# PROJECT.md — Decision Register', '', 'Toolkit commit: stub', 'Exec approval: auto', '', '## Current stage', 'P', '', '## Decisions', '', '| Stage | Decision | Status | Notes |', '|---|---|---|---|', '', '## Open questions', '', '| # | Question | Raised at | Status |', '|---|---|---|---|', '', '## Assumptions (ASSUMED, unresolved)', '', 'None yet.', ''].join('\n');
  fs.writeFileSync(path.join(tk, 'init-project.sh'), init.replace(/echo '[A-Za-z0-9+/=]+' \| base64 -d > "\$d\/PROJECT\.md"/, `echo '${Buffer.from(register).toString('base64')}' | base64 -d > "$d/PROJECT.md"`));
  const userHome = path.join(root, 'userhome');
  const ghConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-empty-gh-'));
  fs.mkdirSync(userHome, { recursive: true });
  const sep = process.platform === 'win32' ? ';' : ':';
  const env = { ...stubs.env, AGENT_OFFICE_PLANNER: 'fake', AGENT_OFFICE_FAKE_PLANNER_MS: '1800', GH_CONFIG_DIR: ghConfig, USERPROFILE: userHome, HOME: userHome, GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@test-office.invalid', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@test-office.invalid', FAKE_MODE: 'turn', FAKE_TURN_MS: '3000', PATH: `${stubs.bin}${sep}${process.env.PATH}` };
  const office = await startTestOffice({ home, env, agent: stubs.agent });
  log('test office up at', office.base);
  const browser = await chromium.launch({ headless: true, executablePath: findChrome() });
  try {
    const cookie = await login(office.base);
    const u = new URL(office.base);
    const cookies = cookie.split('; ').map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1), domain: u.hostname, path: '/' }));
    const newCtx = async (viewport, theme = 'portal-light') => {
      const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
      await ctx.addCookies(cookies);
      await ctx.addInitScript((t) => {
        localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Alex Lee', color: '#0f9b8e', skin: 0, hair: 0, style: 0 }));
        localStorage.setItem('agent-office.color-theme', t);
      }, theme);
      return ctx;
    };
    const ctx = await newCtx({ width: 1440, height: 900 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = (name, p = page) => p.screenshot({ path: path.join(out, `${name}.png`) });
    const api = async (p) => (await fetch(office.base + p, { headers: { cookie } })).json();
    const post = async (p, body) => (await fetch(office.base + p, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: office.base }, body: JSON.stringify(body) })).json();
    const both = async (name, sel, block = 'start') => {
      for (const t of ['portal-light', 'portal-dark']) {
        await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
        await page.waitForTimeout(200);
        if (sel) await page.locator(sel).first().evaluate((el, b) => el.scrollIntoView({ block: b }), block);
        await page.waitForTimeout(150);
        await shot(`${name}-${t.replace('portal-', '')}`);
      }
      await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    };
    const toStep = async (fresh) => {
      await page.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /New project/ }).first().click();
      if (!fresh) {
        await page.waitForSelector('.nw-resume');
        await page.click('.nw-resume button:has-text("Continue")');
      } else {
        await page.waitForSelector('.nw-start.in', { timeout: 20000 });
        await page.fill('#nw-prompt', 'Visitor Registration: an office visitor sign-in app. Visitors sign in at reception, their host approves, and reception prints a badge.');
        await page.click('.nw-primary');
        await page.waitForSelector('#nw-sec-questions[data-state=done]', { timeout: 20000 });
        await page.click('#nw-approve');
        const dlg = await page.waitForSelector('.nw-modal:has-text("Approve anyway")', { timeout: 3000 }).catch(() => null);
        if (dlg) await page.click('.nw-modal button:has-text("Approve anyway")');
      }
      await page.waitForSelector('.nw-dcard', { timeout: 20000 });
      await page.waitForSelector('#nw-autonomy:not([hidden])');
      await page.waitForTimeout(400);
    };

    await toStep(true);
    check(await page.isDisabled('#nw-create'), 'Create project is disabled with nothing chosen');
    check((await page.$$eval('.aw-lvl[aria-checked="true"]', (e) => e.length)) === 0, 'nothing preselected');
    check(/Choose how much the agent team may do/.test((await page.textContent('.nw-approve-hint')) ?? ''), 'Create project says why it waits');
    await both('01-step-empty', '#nw-autonomy');
    await page.click('.aw-lvl[data-level="2"]');
    check(!(await page.isDisabled('#nw-create')), 'Create project is enabled once a level is chosen');
    await both('02-step-picked', '#nw-autonomy');

    // The policy limits the levels.
    await post('/api/autonomy/policy', { mode: 'limit', allowed: [1, 2, 3], name: 'Delivery rules', by: 'Alex Lee' });
    await page.click('.nw-close');
    await toStep(false);
    check((await page.getAttribute('.aw-lvl[data-level="4"]', 'aria-disabled')) === 'true', 'policy limit: 4 disabled');
    await page.click('.aw-lvl[data-level="3"]');
    await both('03-step-policy-limited', '#nw-autonomy');

    // The policy fixes the level: locked, acknowledged.
    await post('/api/autonomy/policy', { mode: 'fixed', level: 2, name: 'Delivery rules', by: 'Alex Lee' });
    await page.click('.nw-close');
    await toStep(false);
    check(await page.isDisabled('#nw-create'), 'policy fixed: Create waits for the acknowledgement');
    await both('04-step-policy-fixed', '#nw-autonomy');
    await page.click('#aw-ack');
    check(!(await page.isDisabled('#nw-create')), 'policy fixed: Create enabled once acknowledged');
    await both('05-step-policy-fixed-ack', '#nw-autonomy');

    // No policy again for the project itself: 2 Guided, the summary, Create.
    await post('/api/autonomy/policy', { mode: 'none', by: 'Alex Lee' });
    await page.click('.nw-close');
    await toStep(false);
    await page.click('.aw-lvl[data-level="2"]');
    await page.click('#nw-create');
    await page.waitForSelector('#nw-create-go');
    await page.waitForTimeout(400);
    for (const t of ['portal-light', 'portal-dark']) {
      await page.evaluate((x) => (document.documentElement.dataset.theme = x), t);
      await page.waitForTimeout(250);
      await shot(`06-summary-${t.replace('portal-', '')}`);
    }
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    check(/2 Guided · chosen by Alex Lee/.test((await page.textContent('.aw-sum')) ?? ''), 'the summary says the level and who');
    await page.click('#nw-create-go');
    await page.waitForSelector('.nw-progress', { timeout: 15000 });
    let job;
    for (let i = 0; i < 240; i++) {
      const id = (await api('/api/wizard/info')).jobs[0]?.id ?? job?.id ?? 'test-org__visitor-registration';
      job = (await api(`/api/wizard/job?id=${encodeURIComponent(id)}`).catch(() => undefined)) ?? job;
      if (job && (job.status === 'done' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    check(job?.status === 'done', `the setup finished offline: ${job?.status}`);
    check(/autonomy: 2 Guided \(chosen\)/.test(job?.log?.join('\n') ?? ''), 'the setup log says the autonomy was applied');
    const roster = await api(`/api/roster?floor=${encodeURIComponent(job.floor)}`);
    check(roster.autonomyRecord?.choice?.source === 'chosen' && roster.autonomyRecord.choice.by === 'Alex Lee', `recorded: ${JSON.stringify(roster.autonomyRecord?.choice)}`);
    check(roster.settings.autonomyByStage.enabled === false, 'the budget level did not turn autonomy by stage on');
    await page.goto(`${office.base}/lite?floor=${encodeURIComponent(job.floor)}&tab=settings&section=team`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ro-origin', { timeout: 20000 });
    check(/2 Guided, chosen by Alex Lee( \(shared password\))? on/.test((await page.textContent('.ro-origin')) ?? ''), 'Settings › Team says who chose it and when');
    await both('07-settings-chosen-by', '.ro-origin', 'end');
    // A change asks first.
    await page.click('.ro-level:has-text("Delegated") input');
    await page.click('#ro-save-settings');
    await page.waitForSelector('.ro-autonomy-confirm');
    await page.waitForTimeout(200);
    await shot('08-settings-change-confirm-light');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await page.evaluate(() => document.activeElement?.id === 'ro-save-settings'), 'Esc gives focus back to Save settings');
    // The Live app frame's own sandbox complaint is not ours.
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

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
