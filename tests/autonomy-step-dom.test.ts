// The autonomy step in headless Chromium with every client stylesheet, Portal Light and Dark: nothing preselected
// and the reason said until a level is picked, a keyboard-operable radio group, the preview generated from the gate
// tables, the policy's limited and fixed variants (fixed: locked, no badge, the acknowledgement needed), the step for
// a new app and for a change to an existing one, the summary before Create, and the Team settings' "chosen by" line
// with the confirmation a level change asks for (✕ and Esc give focus back).
// AUTONOMY_SHOTS=<dir> also saves screenshots there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir)).sort()) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

const PLAN = { kind: 'new', owner: 'test-org', name: 'visitor-registration', description: 'Visitor sign-in at reception', private: true, mendix: '11.12.4', entry: 'greenfield', tier: 'standard', interview: 'steering', execApproval: 'auto', intake: [], clients: [], operators: [], roles: ['chief-analyst', 'lead-developer'], shape: 'startup', discovery: { issue: true, queue: false, model: 'opus' }, createdByHand: false, budget: { level: 'balanced', total: 1450, threshold: 80, autoPause: true, settings: {} } };
const ROSTER = (record: unknown) => ({ floor: 'f1', admin: true, settings: { autonomy: 2, idleMinutes: 0, schedule: { enabled: false, time: '09:00', timeZone: 'UTC', days: [1] }, costCaps: {}, dryRunIssues: false, reviewNudge: true, backToWork: true, jeff: {}, subagentCooldownHours: 24, autonomyByStage: { enabled: false, early: 2, build: 3 }, earlyDrafts: true }, members: [], standups: [], proposals: [{ id: 'p1', status: 'pending', kind: 'design', title: 'x' }, { id: 'p2', status: 'auto' }], approvals: [], escalations: [{ id: 'e1', status: 'open' }], spentToday: 0, activitySinceStandup: false, skills: {}, subagents: [], subagentActions: [], autonomyRecord: record });

const chrome = findChrome();
test('in a browser: the autonomy step, the summary and the Team settings line, Portal Light and Dark', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { autonomyStep } from './wizard/new/autonomy-step';
        import { createSummary, summaryRows } from './wizard/new/create-summary';
        import { autonomyOrigin, confirmAutonomyChange } from './roster/autonomy-change';
        window.mount = (policy, plan) => {
          const host = document.getElementById('host');
          host.replaceChildren();
          window.changes = 0;
          window.plan = plan;
          const s = autonomyStep({ plan, policy, changed: () => window.changes++ });
          host.append(s.el);
          window.step = s;
        };
        window.summary = (plan) => {
          const host = document.getElementById('host');
          const btn = document.createElement('button'); btn.id = 'opener'; btn.textContent = 'Create project'; host.append(btn); btn.focus();
          window.answer = undefined;
          createSummary({ plan, me: 'Alex Lee', host, opener: btn, changeAutonomy: () => {} }).then((a) => (window.answer = a));
          return summaryRows(plan, 'Alex Lee');
        };
        window.origin = (v) => { const host = document.getElementById('host'); host.replaceChildren(autonomyOrigin(v)); return host.textContent; };
        window.confirmChange = (v, to) => {
          const btn = document.createElement('button'); btn.id = 'save'; btn.textContent = 'Save'; document.getElementById('host').append(btn); btn.focus();
          window.answer = undefined;
          confirmAutonomyChange(v, { ...v.settings, autonomy: to }, btn).then((a) => (window.answer = a));
        };`,
      resolveDir: path.join(root, 'src/client/ui'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const css = sheets('src/client')
    .filter((f) => !/login\.css$|[\/]mobile[\/]|[\/]first-run[\/]/.test(f))
    .map((f) => read(f).replace(/@import[^;]+;/g, ''))
    .join('\n');
  const shots = process.env.AUTONOMY_SHOTS;
  if (shots) mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  const text = (page: Page, sel: string) => page.$eval(sel, (e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><style>${css}</style></head><body class="lite"><div id="modal-root"><div class="nw"><main style="padding:16px;max-width:860px;position:relative"><div id="host"></div></main></div></div><div id="toasts"></div></body></html>`);
      await page.addScriptTag({ content: out.outputFiles[0].text });
      const shot = (name: string) => shots && page.screenshot({ path: path.join(shots, `${name}-${theme}.png`), fullPage: true });

      // Empty: nothing checked, the reason said, the recommendation a badge only.
      await page.evaluate((p) => (window as any).mount(undefined, structuredClone(p)), PLAN);
      assert.deepEqual(await page.$$eval('.aw-lvl', (els) => els.map((e) => e.getAttribute('aria-checked'))), ['false', 'false', 'false', 'false'], 'no preselection');
      assert.equal(await text(page, '.aw-h'), 'How much should the agent team do without asking you?');
      assert.equal(await text(page, '#aw-why'), 'Choose a level to continue. Nothing is preselected.');
      assert.equal(await page.evaluate(() => (window as any).step.problem()), 'Choose how much the agent team may do without asking you');
      assert.equal(await text(page, '.aw-lvl[data-level="2"] .aw-rec'), 'Recommended for a new project');
      assert.equal(await page.$$eval('.aw-rec', (els) => els.length), 1);
      assert.equal(await page.getAttribute('.aw-lvls', 'role'), 'radiogroup');
      assert.match(await text(page, '.aw-preview'), /^Pick a level/);
      await shot('step-empty');

      // Keyboard: Tab reaches the group, arrows pick, Space too.
      await page.focus('.aw-lvl[tabindex="0"]');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-level')), '1');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-level')), '2');
      assert.equal(await page.getAttribute('.aw-lvl[data-level="2"]', 'aria-checked'), 'true');
      assert.deepEqual(await page.evaluate(() => (window as any).plan.autonomy), { level: 2 });
      assert.equal(await page.evaluate(() => (window as any).step.problem()), undefined);
      assert.equal(await text(page, '#aw-why'), '');
      assert.ok((await page.evaluate(() => (window as any).changes)) > 0);
      // The preview is the generated copy, each approval with how it is held, and the footer.
      assert.equal(await text(page, '.aw-ph'), 'Preview: 2 Guided');
      const marks = await page.$$eval('.aw-pb > div:nth-child(2) li', (els) => els.map((e) => [e.firstChild?.textContent?.trim(), e.querySelector('.aw-mk')?.textContent]));
      assert.deepEqual(marks.at(-2), ['Spending past the budget', 'stops automatically']);
      assert.deepEqual(marks.at(-1), ['Hands-on actions only a person can do (sign-ins, keys, installs)', 'only you can']);
      assert.deepEqual(marks[0], ['Work outside the agreed scope', 'team is told to wait']);
      assert.match(await text(page, '.aw-held'), /merges are only blocked if your main branch is protected on GitHub/);
      const told = await page.$eval('.aw-mk.told', (e) => getComputedStyle(e).backgroundColor);
      const stops = await page.$eval('.aw-mk.stops', (e) => getComputedStyle(e).backgroundColor);
      assert.notEqual(told, stops, 'told and enforced look different');
      // The by-stage option, unticked, below Delegated.
      assert.equal(await page.isChecked('#aw-bystage'), false);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press(' ');
      assert.deepEqual(await page.evaluate(() => (window as any).plan.autonomy), { level: 3 });
      assert.equal(await page.$('#aw-bystage'), null, 'not offered at Delegated');
      await page.click('.aw-lvl[data-level="2"]');
      await page.click('#aw-bystage');
      assert.deepEqual(await page.evaluate(() => (window as any).plan.autonomy), { level: 2, byStage: true });
      await shot('step-picked');

      // An existing app's change: the same step.
      await page.evaluate((p) => (window as any).mount(undefined, { ...structuredClone(p), kind: 'change', entry: 'existing-app-change' }), PLAN);
      assert.deepEqual(await page.$$eval('.aw-lvl[aria-checked="true"]', (els) => els.length), 0, 'no preselection for a change either');
      await page.click('.aw-lvl[data-level="4"]');
      assert.match(await text(page, '.aw-pb'), /Merging finished work into the main version/);

      // The policy limits the levels: the others disabled and skipped by the arrows.
      await page.evaluate((p) => (window as any).mount({ mode: 'limit', allowed: [1, 2, 3], name: 'Delivery rules' }, structuredClone(p)), PLAN);
      assert.equal(await page.getAttribute('.aw-lvl[data-level="4"]', 'aria-disabled'), 'true');
      assert.equal(await text(page, '.aw-lvl[data-level="4"] .aw-off'), 'Not allowed by your organisation’s policy');
      await page.click('.aw-lvl[data-level="4"]', { force: true });
      assert.equal(await page.evaluate(() => (window as any).plan.autonomy), undefined, 'a disallowed level can’t be picked');
      await page.click('.aw-lvl[data-level="3"]');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => (window as any).plan.autonomy.level), 1, 'the arrows skip 4');
      await page.click('.aw-lvl[data-level="3"]');
      assert.match(await text(page, '.aw-policy'), /allows 1 Directive, 2 Guided, 3 Delegated/);
      await shot('step-policy-limited');

      // The policy fixes the level: shown chosen and locked, no badge, the acknowledgement needed.
      await page.evaluate((p) => (window as any).mount({ mode: 'fixed', level: 2, name: 'Delivery rules' }, structuredClone(p)), PLAN);
      assert.equal(await page.getAttribute('.aw-lvl[data-level="2"]', 'aria-checked'), 'true');
      assert.equal(await page.$$eval('.aw-rec', (els) => els.length), 0, 'no badge on a fixed level');
      assert.equal(await page.$$eval('.aw-lvl[aria-disabled="true"]', (els) => els.length), 3);
      assert.equal(await text(page, '#aw-why'), 'Confirm the level your organisation set to continue.');
      assert.match(await page.evaluate(() => (window as any).step.problem()), /^Confirm you understand/);
      await page.click('.aw-lvl[data-level="3"]', { force: true });
      assert.equal(await page.evaluate(() => (window as any).plan.autonomy.level), 2);
      await page.click('#aw-ack');
      assert.deepEqual(await page.evaluate(() => (window as any).plan.autonomy), { level: 2, ack: true });
      assert.equal(await page.evaluate(() => (window as any).step.problem()), undefined);
      await shot('step-policy-fixed-ack');

      // The summary before Create: the level, who, the approvals, spend set separately; ✕ and Esc give focus back.
      const rows: [string, string, string?][] = await page.evaluate((p) => (window as any).summary({ ...structuredClone(p), autonomy: { level: 2 } }), PLAN);
      // A new project's summary also says where the code lives (Code: repo-home-field.ts).
      assert.deepEqual(rows.map((r) => r[0]), ['Project', 'Code', 'Agent team autonomy', 'Still needs you', 'Spend', 'Team', 'Deployment']);
      assert.equal(rows[2][1], '2 Guided · chosen by Alex Lee');
      assert.match(rows[4][2]!, /budget level never changes what the team may do/);
      await page.waitForFunction(() => document.activeElement?.id === 'nw-create-go', null, { timeout: 3000 });
      assert.ok(await page.$('.nw-modal .nw-x[aria-label="Close"]'), 'a ✕');
      await shot('summary');
      await page.click('.nw-modal .nw-x');
      await page.waitForFunction(() => (window as any).answer === false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'opener', 'focus back to Create project');
      await page.evaluate((p) => (window as any).summary({ ...structuredClone(p), autonomy: { level: 2 } }), PLAN);
      await page.waitForSelector('.nw-modal.show, .nw-overlay.show .nw-modal');
      await page.click('#nw-create-go');
      await page.waitForFunction(() => (window as any).answer === true);

      // The Team settings: who chose it and when; a project from before the step says so.
      const at = Date.UTC(2026, 9, 20, 10);
      assert.match(await page.evaluate((r) => (window as any).origin(r), ROSTER({ choice: { level: 2, source: 'chosen', by: 'Alex Lee', at }, policy: { mode: 'none' } })), /^2 Guided, chosen by Alex Lee on (20 Oct 2026|Oct 20, 2026).$/);
      assert.match(await page.evaluate((r) => (window as any).origin(r), ROSTER({ choice: { level: 2, source: 'policy', by: 'Alex Lee', at, policy: 'Delivery rules', acknowledged: true }, last: { from: 2, to: 3, by: 'Sam Okafor', at }, policy: { mode: 'fixed', level: 2 } })), /set by your organisation’s policy \(Delivery rules\), acknowledged by Alex Lee on (20 Oct 2026|Oct 20, 2026). Changed from 2 Guided to 3 Delegated by Sam Okafor on (20 Oct 2026|Oct 20, 2026). Office policy for new projects: Fixed at 2 Guided\./);
      assert.match(await page.evaluate((r) => (window as any).origin(r), ROSTER({ policy: { mode: 'none' } })), /^No choice recorded: this project was set up before the autonomy step/);
      // The confirmation of a change: what it does, the waiting items kept; Esc gives focus back.
      await page.evaluate((r) => (window as any).confirmChange(r, 4), ROSTER({ policy: { mode: 'none' } }));
      await page.waitForSelector('.ro-autonomy-confirm');
      const words = await text(page, '.ro-autonomy-confirm .body');
      assert.match(words, /From 2 Guided to 4 Autonomous: it applies to new work/);
      assert.match(words, /2 items already waiting for you .* keep their status: raising autonomy doesn’t approve them/);
      assert.match(words, /Playbook rewritten/);
      assert.match(words, /recorded in the audit log with your name, the time and both levels/);
      assert.ok(await page.$('.ro-autonomy-confirm .close'), 'a ✕');
      await shot('settings-confirm');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => (window as any).answer === false);
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'save', 'Esc gives focus back to Save');
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
