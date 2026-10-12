// The New project flow end to end, in a throwaway TEST office with the test planner (AGENT_OFFICE_PLANNER=fake):
// start page → attach a file → draft the brief → confirm an assumption → a chat message → approve with
// assumptions left → functional domains → Team & budget (Startup · Balanced) → Create project → the setup
// finishes offline. Then it checks the project on disk (intake.md, PROJECT.md, docs/project-brief.md, sources/,
// the Discovery issue file) and takes a screenshot of each screen (Portal Light, plus Dark and a phone's).
//
//   npm run build && node scripts/wizard-e2e.mjs [--root <scratch/test-offices/...>] [--out <shots dir>]
//
// No GitHub (offline wizard: local bare repositories), no real Claude (the test planner and the fake agent),
// GH_TOKEN/GITHUB_TOKEN removed and GH_CONFIG_DIR pointed at an empty folder; the office is stopped at the end.
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
const root = path.resolve(arg('--root', path.join(REPO, '..', '..', 'scratch', 'test-offices', 'wizard-brief-e2e')));
const out = path.resolve(arg('--out', path.join(REPO, '..', '..', 'scratch', 'wizard-brief-shots')));
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
  fs.writeFileSync(path.join(tk, 'init-project.sh'), init);
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

    await page.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /New project/ }).first().click();
    await page.waitForSelector('.nw-start.in', { timeout: 20000 });
    const status = await api('/api/brief/status');
    check(status.available && status.fake, `the planner is the test planner (${status.model})`);
    await page.fill('#nw-prompt', 'Visitor Registration: an office visitor sign-in app. Visitors sign in at reception (or on a kiosk), their host gets a notification and approves, and reception prints a badge with the visitor\'s name, photo and host. We want to replace the paper visitor book at our 3 offices. Success: sign-in under a minute, hosts respond fast, and a reliable list of who is in the building for evacuations.');
    // + menu, then the files dialog with a real upload.
    await page.click('[aria-label="Add files or sources"]');
    await page.waitForSelector('.nw-menu:not([hidden])');
    await shot('02-start-plus-menu');
    await page.getByRole('menuitem', { name: /Upload files/ }).click();
    await page.waitForSelector('.nw-modal .nw-drop');
    const md = path.join(root, 'Visitor-process-workshop.md');
    fs.writeFileSync(md, '# Visitor process workshop\n\nSign-in under 60 seconds. Badges print on the Zebra printers at reception.\nParking is out of scope.\n');
    await page.setInputFiles('.nw-modal input[type=file]', md);
    await page.waitForSelector('.nw-fileline');
    await shot('03-attach-modal');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nw-modal', { state: 'detached' });
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Add files or sources'), 'Esc closes the files dialog and gives focus back to the + button');
    await shot('01-start');
    const detected = await page.textContent('.nw-detected');
    check(/Requirements-driven/.test(detected ?? ''), `entry mode follows the attachment: ${detected?.trim()}`);
    check(/test planner/.test((await page.textContent('.nw-footnote')) ?? ''), 'the footnote says what drafting costs (the test planner: nothing)');

    // Phone: the start page.
    const phone = await newCtx({ width: 390, height: 844 });
    const pp = await phone.newPage();
    await pp.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
    await pp.getByRole('button', { name: /New project/ }).first().click();
    await pp.waitForSelector('.nw-start.in');
    await pp.fill('#nw-prompt', 'Visitor Registration: an office visitor sign-in app with host approval and badges.');
    await shot('19-phone-start', pp);
    check(await pp.evaluate(() => document.documentElement.scrollWidth <= 390 && document.querySelector('.nw-start').scrollWidth <= 390), 'no sideways scroll at 390 px');
    await pp.click('.nw-close');

    // Draft.
    await page.click('.nw-primary');
    await page.waitForSelector('.nw-plan.in');
    await page.waitForTimeout(500);
    await shot('04-brief-drafting');
    check(await page.isVisible('.nw-skel'), 'drafting shows skeleton lines');
    await page.waitForSelector('#nw-sec-questions[data-state=done]', { timeout: 20000 });
    await page.waitForTimeout(400);
    await shot('05-brief-ready');
    const counter = await page.textContent('.nw-counter');
    check(/3 assumptions/.test(counter ?? '') && /2 open questions/.test(counter ?? ''), `the header counts: ${counter}`);
    // Confirm one assumption, then a chat message.
    await page.locator('.nw-item.assumed button', { hasText: 'Confirm' }).first().click();
    await page.waitForFunction(() => /2 assumptions/.test(document.querySelector('.nw-counter')?.textContent ?? ''));
    const confirmedSrc = await page.locator('#nw-it-s2 .nw-src').textContent();
    check(/confirmed by you · \d\d:\d\d/.test(confirmedSrc ?? ''), `Confirm records "${confirmedSrc?.trim()}"`);
    await page.fill('#nw-chat-in', 'We also have a security desk that needs to know about flagged visitors.');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.nw-role:has-text("Security officer")', { timeout: 15000 });
    await page.waitForTimeout(300);
    await shot('06-brief-confirm-and-chat');
    check(await page.isVisible('.nw-msg:has-text("Security officer")'), 'the Chief Analyst answers in the chat and the brief changes');

    // Dark and phone shots of the brief.
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await page.waitForTimeout(250);
    await shot('20-brief-dark');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    const pp2 = await phone.newPage();
    await pp2.goto(`${office.base}/home`, { waitUntil: 'domcontentloaded' });
    await pp2.getByRole('button', { name: /New project/ }).first().click();
    await pp2.waitForSelector('.nw-resume');
    await pp2.click('.nw-resume button:has-text("Continue")');
    await pp2.waitForSelector('#nw-sec-questions[data-state=done]', { timeout: 15000 });
    await shot('20-phone-brief', pp2);
    check(await pp2.evaluate(() => document.querySelector('.nw-doc').scrollWidth <= 390), 'the brief fits a 390 px phone');
    await pp2.click('.nw-chat-h');
    await pp2.waitForTimeout(300);
    await shot('21-phone-chat-sheet', pp2);
    await phone.close();

    // Approve with assumptions left.
    await page.click('#nw-approve');
    await page.waitForSelector('.nw-modal:has-text("Approve with assumptions?")');
    await shot('07-approve-dialog');
    check(/2 items are still Assumed; they’ll be recorded as ASSUMED/.test((await page.textContent('.nw-modal')) ?? ''), 'the approve dialog says what stays ASSUMED');
    await page.click('.nw-modal button:has-text("Approve anyway")');
    await page.waitForSelector('.nw-panel[aria-label="Functional domains"] .nw-drafting', { timeout: 10000 });
    await shot('08-domains-analysing');
    await page.waitForSelector('.nw-dcard', { timeout: 20000 });
    await page.waitForTimeout(500);
    await shot('09-domains');
    await page.locator('.nw-dcard').first().click();
    await page.waitForSelector('.nw-side.show');
    await page.waitForTimeout(250);
    await shot('10-domain-panel');
    check(/VIS-1/.test((await page.textContent('.nw-side')) ?? ''), 'the domain panel lists stories with ids');
    await page.keyboard.press('Escape');
    await page.waitForSelector('.nw-side', { state: 'detached' });

    // Team & budget: Startup · Balanced.
    await page.waitForSelector('.nw-team-txt');
    await page.locator('.nw-team-txt').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot('11-team-budget');
    const rec = await page.textContent('.nw-team-txt');
    log('recommended:', rec?.replace(/\s+/g, ' '));
    await page.click('.nw-team-sum button:has-text("Change")');
    await page.click('[data-shape=startup]');
    await page.click('[data-level=balanced]');
    await page.click('.nw-adv-h');
    await page.waitForTimeout(300);
    await shot('12-team-change-advanced');
    const team = await page.textContent('.nw-team-txt');
    check(/Startup · Balanced/.test(team ?? '') && /2 agents/.test(team ?? ''), `the team card: ${team?.replace(/\s+/g, ' ').slice(0, 120)}`);
    const repoName = await page.inputValue('#nw-a-name');
    check(repoName === 'visitor-registration', `the repository name comes from the brief: ${repoName}`);
    // A bad name is caught inline, next to the field.
    await page.fill('#nw-a-name', '-');
    await page.click('#nw-create');
    await page.waitForSelector('#nw-err-name:not(:empty)');
    check(true, `an invalid name shows inline: ${await page.textContent('#nw-err-name')}`);
    await page.fill('#nw-a-name', 'visitor-registration');
    await page.click('#nw-create');
    await page.waitForSelector('.nw-progress', { timeout: 15000 });
    await shot('13-setup-progress');
    const jobId = 'test-org__visitor-registration';
    let job;
    for (let i = 0; i < 240; i++) {
      job = await api(`/api/wizard/job?id=${encodeURIComponent(jobId)}`).catch(() => undefined);
      if (job && (job.status === 'done' || job.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!job?.status) job = (await api('/api/wizard/info')).jobs[0];
    await page.waitForTimeout(1500);
    await shot('14-setup-done');
    check(job?.status === 'done', `the setup finished offline: ${job?.status} ${job?.steps?.filter((s) => s.status === 'failed').map((s) => `${s.id}: ${s.detail}`).join('; ') ?? ''}`);

    // On disk.
    const find = (dir, name, depth = 4) => {
      if (depth < 0 || !fs.existsSync(dir)) return undefined;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isFile() && e.name === name) return p;
        if (e.isDirectory() && !['.git', 'node_modules'].includes(e.name)) {
          const f = find(p, name, depth - 1);
          if (f) return f;
        }
      }
      return undefined;
    };
    const projDir = path.dirname(find(path.join(home, 'projects'), 'PROJECT.md') ?? path.join(home, 'projects', 'x', 'PROJECT.md'));
    const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    const intake = read(path.join(projDir, 'intake.md'));
    const reg = read(path.join(projDir, 'PROJECT.md'));
    const briefMd = read(path.join(projDir, 'docs', 'project-brief.md'));
    const issueFile = find(path.join(root, 'github'), '1.md', 3);
    const issue = issueFile ? read(issueFile) : '';
    check(/Assumed: Give each office|Answered \(CONFIRMED\): Give each office/.test(intake) && /\[ASSUMED, inferred from "hosts respond fast"\]|confirmed by Alex Lee/.test(intake), 'intake.md Q2 has the goal and the success criteria with their tags');
    check(/Unverified — how to verify: ask the client in the Discovery interview/.test(intake), 'intake.md Q8 has the open questions as Unverified');
    check(/In scope: Visitor check-in/.test(intake) && /Input documents: Visitor-process-workshop\.md \(in sources\/\)/.test(intake), 'intake.md Q4 has the scope and the input document');
    check(/\| 0 \| Scope: project brief approved \(docs\/project-brief\.md\) \| CONFIRMED \d{4}-\d\d-\d\d \|/.test(reg), 'PROJECT.md records the Stage 0 scope approval as CONFIRMED');
    check((reg.match(/\| ASSUMED \d{4}/g) ?? []).length === 2, `PROJECT.md records the ${(reg.match(/\| ASSUMED \d{4}/g) ?? []).length} items still Assumed as ASSUMED`);
    check(/Interview mode: steering/.test(reg), 'PROJECT.md has the interview mode');
    check(/# Project brief: Visitor Registration/.test(briefMd) && /Security officer/.test(briefMd) && /### VIS: Visitor check-in/.test(briefMd), 'docs/project-brief.md has the brief, the chat’s change and the domains');
    check(/confirmed by Alex Lee/.test(briefMd), 'docs/project-brief.md says who confirmed what');
    check(fs.existsSync(path.join(projDir, 'sources', 'Visitor-process-workshop.md')), 'the attachment is in sources/');
    check(/## The project brief \(approved in the wizard\)/.test(issue) && /Still ASSUMED/.test(issue) && /HST Host approval/.test(issue), 'the Discovery issue carries the brief, the assumptions and the domains');
    const drafts = path.join(home, '.agent-office');
    const leftover = find(drafts, 'draft.json', 4);
    check(!leftover, 'the draft and its files are gone once the setup finished');
    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    fs.writeFileSync(path.join(out, 'e2e-result.json'), JSON.stringify({ checks, projDir, job: job?.status }, null, 2));
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
