// C4 of the App Workspace (change requests and decisions with artifacts) in headless Chromium, with the page's own
// styles and a test source in place of the page's feeds: the panel's current request and Request a change (the
// project, the canvas's page and the running version captured; ✕ top right, Esc and ✕ give the focus back), the
// Requests list with each state in business words and the version that has it, the business decisions with the
// related artifact beside only those that name one, an answer sent with its revision and a stale one's 409 shown
// plainly, no engineering words anywhere it draws, and a phone width. AW_SHOTS=<dir> saves Light, Dark and phone
// screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.AW_SHOTS;
const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '5e21c9daaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = Date.now();
const chrome = findChrome();

const req = (o: Record<string, unknown>) => ({ taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ0', by: 'Alex Lee', role: 'pm', member: 'Ada', delivery: 'sent', ...o });
const REQUESTS = [
  req({ id: 'CR-3', text: 'Show the host’s name on the printed badge.', at: now - 600_000, page: '/p/Badge', revision: A, state: 'working', words: 'Being worked on', detail: 'The team is working on it.' }),
  req({ id: 'CR-2', text: 'Let reception see who signed a visitor in, next to the arrival time.', at: now - 7_200_000, page: '/p/Visitors', revision: B, state: 'ready', words: 'Ready to try', detail: 'In the running version now: try it in the app.', version: A }),
  req({ id: 'CR-1', text: 'Early arrivals should wait for their host to approve.', at: now - 86_400_000, state: 'needs-answer', words: 'Needs your answer', detail: 'The team needs a decision from you to go on: it’s under Decisions.' }),
];

const DATA = {
  floor: 'f1',
  project: 'Visitor Registration',
  live: { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, started: true, branch: 'main', appPort: 8123, since: now - 600_000, served: { sha: A, subject: 'Host approval', builtAt: now - 540_000 } },
  appUrl: 'http://127.0.0.1:8123/',
  business: { state: 'ready-for-review', label: 'Ready for business review', about: 'all', revision: A, revisionKind: 'served', version: 'v1', tone: 'busy', notes: [], missing: ['no journey evidence for 7d3f0b1'], line: '' },
  milestones: [],
  progress: { toolkit: false, done: 3, total: 6, acceptance: { version: 'v1', cycle: 1, earlier: [] } },
  brief: { title: 'Visitor Registration', goal: ['Visitors sign in at reception and their host approves.'], domains: [], questions: [] },
  decisions: [
    { id: 'esc:e1', escalation: 'e1', others: [], question: 'Can a host approve an early arrival, or must the visitor wait?', detail: 'Reception sees early arrivals every morning.', owner: 'Ada', level: 'block', since: now - 3_600_000, options: ['Host approves from the list', 'Visitor waits until the booked time'], recommendation: 'Host approves from the list: fewer people waiting', artifact: { kind: 'screenshot', ref: 'design/shots/visitors.png' } },
    { id: 'esc:e2', escalation: 'e2', others: [], question: 'Keep visitor records for 30 or 90 days?', owner: 'Cleo', level: 'warn', options: ['30 days', '90 days'], artifact: { kind: 'process-map', ref: 'docs/process-map.html' } },
    { id: 'q:F1#OQ-3', question: 'Should a visitor’s company be required?', owner: 'the analyst', level: 'warn' },
  ],
  others: 3,
  changes: [],
  autonomy: { level: 2, name: 'Guided', byStage: false },
  admin: true,
  requests: REQUESTS,
};

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import { createWorkspace } from './shell';
        let data = {};
        const fns = new Set();
        window.__opened = []; window.__asked = []; window.__answers = []; window.__answerWith = { ok: true }; window.__requestWith = undefined;
        const ws = createWorkspace({
          source: {
            get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {},
            request: async (a) => (window.__asked.push(a), window.__requestWith ?? { ok: true, request: { id: 'CR-4', member: 'Ada', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ1' } }),
            answer: async (x, a) => (window.__answers.push({ id: x.id, escalation: x.escalation, ...a }), window.__answerWith),
          },
          open: (t) => window.__opened.push(t),
        });
        document.querySelector('.lite-main').append(ws.el);
        window.__set = (d) => { data = { ...d, decisions: d.decisions && d.decisions.map((x) => ({ ...x, answer: () => window.__opened.push('answer:' + x.id) })) }; fns.forEach((fn) => fn()); };
        window.__show = (s) => ws.show(s);`,
      resolveDir: path.join(root, 'src/client/ui/app-workspace'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty', '.ttf': 'empty' },
    logLevel: 'silent',
  });
  return { js: out.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: out.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;color:#2f3646;background:#fff}header{background:#264ae5;color:#fff;padding:12px 16px;font-weight:600}main{padding:16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}button{padding:6px 12px}</style></head><body><header>Visitor Registration · Reception</header><main><h2>Today's visitors</h2><table><tr><th>Visitor</th><th>Host</th><th>Arrived</th><th>Status</th></tr><tr><td>Sam Doe</td><td>Alex Lee</td><td>08:41</td><td>Waiting for host</td></tr><tr><td>Kim Park</td><td>Jo Smith</td><td>09:02</td><td>Approved</td></tr></table><p><button>Sign in a visitor</button></p></main></body></html>`;

async function open(page: Page, h: { js: string; css: string }, theme: string, shot: Buffer) {
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1:8123/')) return r.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE });
    if (u.includes('/api/deliverables/file') && u.includes('visitors.png')) return r.fulfill({ status: 200, contentType: 'image/png', body: shot });
    if (u === 'http://office.test/lite') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://office.test/lite');
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite"><main class="lite-main"></main><div id="modal-root"></div><div id="toasts"></div></body></html>`);
  await page.addScriptTag({ content: h.js });
}

const W = (page: Page) => page as unknown as { evaluate: Page['evaluate'] };
const set = (page: Page, d: object) => W(page).evaluate((x) => (window as unknown as { __set(d: unknown): void }).__set(x), d as Record<string, unknown>);
const show = (page: Page, s: string) => W(page).evaluate((x) => (window as unknown as { __show(s: string): void }).__show(x), s);
const text = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const get = <T>(page: Page, k: string) => page.evaluate((x) => (window as unknown as Record<string, unknown>)[x], k) as Promise<T>;
test('in a browser: the current request, Request a change, the Requests list, decisions with artifacts, a stale answer and the phone', { skip: chrome ? false : 'no Chromium here', timeout: 150_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const shotPage = await browser.newPage({ viewport: { width: 900, height: 420 } });
    await shotPage.setContent(APP_PAGE);
    const shot = await shotPage.screenshot();
    await shotPage.close();
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, h, 'portal-light', shot);
    await set(page, DATA);
    await show(page, 'app');

    // The panel's current request: the newest that isn't settled, its state in business words.
    assert.match((await text(page, '[data-part="request"] .aw-q')) ?? '', /Show the host’s name on the printed badge/);
    assert.equal(await text(page, '[data-part="request"] .aw-pill'), 'Being worked on');
    assert.match((await text(page, '[data-part="request"]')) ?? '', /3 requests in all, under Decisions/);
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-01-app-request-light.png') });

    // Request a change: the context captured; ✕ top right; Esc gives the focus back to the button.
    await page.focus('[data-part="request"] .aw-ask');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aw-reqdlg');
    assert.match((await text(page, '.aw-reqdlg .aw-about')) ?? '', /ProjectVisitor Registration[\s\S]*Page\/[\s\S]*Versionrunning 7d3f0b1/);
    const x = await page.evaluate(() => {
      const d = document.querySelector('.aw-reqdlg')!.getBoundingClientRect();
      const b = document.querySelector('.aw-reqdlg .close')!.getBoundingClientRect();
      return { right: d.right - b.right, top: b.top - d.top };
    });
    assert.ok(x.right < 40 && x.top < 40, `the ✕ is top right (${JSON.stringify(x)})`);
    if (shots) await page.waitForTimeout(500), await page.screenshot({ path: path.join(shots, 'c4-02-request-dialog-light.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.aw-reqdlg').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aw-ask')), true, 'Esc: the focus is back on Request a change');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aw-reqdlg');
    await page.click('.aw-reqdlg .close');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aw-ask')), true, '✕: the focus is back');
    // Empty: said, nothing sent. A refusal is shown in the dialog. Then sent.
    await page.keyboard.press('Enter');
    await page.click('.aw-reqsend');
    assert.match((await text(page, '.aw-reqdlg [role="alert"]')) ?? '', /Say what should change first/);
    await page.evaluate(() => ((window as unknown as { __requestWith: unknown }).__requestWith = { ok: false, error: 'No team lead is at work on this project yet, so nobody can take the request. Start the team in Project Management, then ask again.' }));
    await page.fill('.aw-reqtext', 'Print the visitor’s photo on the badge.');
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => /No team lead/.test(document.querySelector('.aw-reqdlg [role="alert"]')?.textContent ?? ''));
    await page.evaluate(() => ((window as unknown as { __requestWith: unknown }).__requestWith = undefined));
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => !document.querySelector('.aw-reqdlg'));
    assert.match((await text(page, '#toasts')) ?? '', /Request CR-4 sent to Ada: it shows in the panel with its state/);
    assert.deepEqual(await get(page, '__asked'), [{ text: 'Print the visitor’s photo on the badge.', page: '/', revision: A }, { text: 'Print the visitor’s photo on the badge.', page: '/', revision: A }], 'the page on screen and the running version go with it');

    // Decisions: business decisions only (the source filtered them), the artifact only beside those that name one.
    await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
    await show(page, 'decisions');
    assert.equal(await page.locator('.aw-decision').count(), 3);
    assert.equal(await page.locator('.aw-decision .aw-artifact').count(), 2);
    assert.equal(await page.locator('.aw-decision[data-id="q:F1#OQ-3"] .aw-artifact').count(), 0, 'no explicit id: no artifact');
    assert.equal(await page.getAttribute('.aw-decision[data-id="esc:e1"] .aw-artifact', 'data-artifact'), 'screenshot');
    await page.waitForFunction(() => (document.querySelector('.aw-shot') as HTMLImageElement | null)?.complete === true);
    assert.match((await page.getAttribute('.aw-decision[data-id="esc:e2"] .aw-artifact a', 'href')) ?? '', /^\/api\/deliverables\/file\?floor=f1&path=docs%2Fprocess-map\.html$/);
    assert.equal(await text(page, '.aw-decision[data-id="esc:e1"] .aw-opt[aria-pressed="true"] b'), 'Host approves from the list', 'the team’s recommendation picked');
    // The client question is answered where it's answered today.
    await page.click('.aw-decision[data-id="q:F1#OQ-3"] button:has-text("Answer")');
    assert.equal((await get<string[]>(page, '__opened')).at(-1), 'answer:q:F1#OQ-3');
    // Requests: every request, its state and the version that has it.
    assert.deepEqual(await page.$$eval('.aw-reqrow .aw-pill', (p) => p.map((x) => x.textContent)), ['Being worked on', 'Ready to try', 'Needs your answer']);
    assert.match((await text(page, '.aw-reqrow[data-request="CR-2"]')) ?? '', /version 7d3f0b1[\s\S]*on \/p\/Visitors · looking at version 5e21c9d/);
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-03-decisions-light.png'), fullPage: true });

    // A stale answer: the office's 409, said plainly, with the new version.
    await page.evaluate(() => ((window as unknown as { __answerWith: unknown }).__answerWith = { ok: false, status: 409, error: 'Answered already', current: { rev: 1, state: 'answered by Jo', open: 'Already answered by Jo' } }));
    await page.click('.aw-decision[data-id="esc:e1"] .aw-send');
    await page.waitForSelector('.aw-note-msg.stale');
    assert.match((await text(page, '.aw-decision[data-id="esc:e1"] .aw-note-msg')) ?? '', /This question changed since you opened it\. Here’s the new version\.Already answered by Jo/);
    assert.deepEqual((await get<object[]>(page, '__answers'))[0], { id: 'esc:e1', escalation: 'e1', verdict: 'reply', text: 'Go with: Host approves from the list' });
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-04-stale-answer-light.png') });
    // The decision answered elsewhere leaves the list; the note stays, with its question.
    await set(page, { ...DATA, decisions: DATA.decisions.slice(1) });
    assert.match((await text(page, '.aw-note-msg.stale')) ?? '', /This question changed since you opened it[\s\S]*Can a host approve an early arrival/);
    // An answer that goes: said so.
    await page.evaluate(() => ((window as unknown as { __answerWith: unknown }).__answerWith = { ok: true }));
    await page.click('.aw-decision[data-id="esc:e2"] .aw-send');
    assert.match((await text(page, '.aw-decision[data-id="esc:e2"] .aw-warn')) ?? '', /Pick an option, or write your answer/);
    await page.click('.aw-decision[data-id="esc:e2"] .aw-opt >> nth=1');
    await page.fill('.aw-decision[data-id="esc:e2"] .aw-note', 'Ninety, for the audit.');
    await page.click('.aw-decision[data-id="esc:e2"] .aw-send');
    await page.waitForSelector('.aw-decision[data-id="esc:e2"] .aw-note-msg.sent');
    assert.deepEqual((await get<object[]>(page, '__answers'))[1], { id: 'esc:e2', escalation: 'e2', verdict: 'reply', text: 'Go with: 90 days\n\nNinety, for the audit.' });

    // Not the Project Manager: no answer form, the decision's own page instead.
    await set(page, { ...DATA, admin: false });
    assert.equal(await page.locator('.aw-answer').count(), 0);
    assert.match((await text(page, '.aw-decision[data-id="esc:e1"]')) ?? '', /Only the Project Manager \(an admin\) can answer this\./);

    // Dark.
    await set(page, DATA);
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-05-decisions-dark.png'), fullPage: true });
    await show(page, 'app');
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-06-app-request-dark.png') });
    await page.focus('[data-part="request"] .aw-ask');
    await page.keyboard.press('Enter');
    await page.fill('.aw-reqtext', 'Print the visitor’s photo on the badge.');
    if (shots) await page.waitForTimeout(500), await page.screenshot({ path: path.join(shots, 'c4-07-request-dialog-dark.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));

    // Nothing yet: what will appear.
    await set(page, { ...DATA, requests: [], decisions: [] });
    assert.match((await text(page, '[data-part="request"]')) ?? '', /Describe what should behave differently/);
    await show(page, 'decisions');
    assert.match((await text(page, '.aw-page')) ?? '', /No requests yet/);

    // A phone: no sideways scrolling, the artifact above its card, the dialog fits.
    await page.setViewportSize({ width: 400, height: 860 });
    await set(page, DATA);
    await show(page, 'decisions');
    await page.waitForTimeout(100);
    const phone = await page.evaluate(() => {
      const a = document.querySelector('.aw-decision[data-id="esc:e2"] .aw-artifact')!.getBoundingClientRect();
      const c = document.querySelector('.aw-decision[data-id="esc:e2"] .aw-dcard')!.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, above: a.bottom <= c.top + 1 };
    });
    assert.ok(phone.scroll <= 400, `no sideways scrolling at 400 px (${phone.scroll})`);
    assert.ok(phone.above, 'the artifact stacks above its card');
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-08-phone-decisions-light.png'), fullPage: true });
    await show(page, 'app');
    await page.focus('[data-part="request"] .aw-ask');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aw-reqdlg');
    const dlg = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, w: document.querySelector('.aw-reqdlg')!.getBoundingClientRect().width }));
    assert.ok(dlg.scroll <= 400 && dlg.w <= 400, `the dialog fits a phone (${JSON.stringify(dlg)})`);
    if (shots) await page.waitForTimeout(500), await page.screenshot({ path: path.join(shots, 'c4-09-phone-request-light.png') });
    await page.keyboard.press('Escape');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await show(page, 'decisions');
    if (shots) await page.screenshot({ path: path.join(shots, 'c4-10-phone-decisions-dark.png'), fullPage: true });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
