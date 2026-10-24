// C5 of the App Workspace (guided validation and accept) in headless Chromium, with the page's own styles and a
// test source in place of the page's feeds, except the acceptance path, which is the page's own
// (validation-api.ts pageAcceptance) against routed /api/acceptance calls: the Review section's checks for the
// version on screen with their results there (an earlier version's pass only a note), steps, Try it opening
// the canvas at the start page, Works as expected / Something's wrong (✕ top right; Esc and ✕ give the focus
// back; the page and version captured), a correction's state from Requests; the Release section's facts, Accept
// through POST /api/acceptance with the existing body, a security refusal and a stale review said in business
// words, Reopen, a member who isn't the Project Manager, no engineering words anywhere it draws, and a phone.
// AW_SHOTS=<dir> saves Light, Dark and phone screenshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.AW_SHOTS;
const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OLD = '5e21c9daaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = Date.now();
const chrome = findChrome();

const SCENARIOS = [
  { id: 'J-01', title: 'Reception signs a visitor in', steps: ['Open the visitor list', 'Click Sign in visitor', 'Type the visitor’s name and the host', 'The visitor shows as waiting'], start: { path: '/p/Visitors' }, result: 'passed', marks: 1, finding: { id: 'GV-1', revision: A, scenario: 'J-01', title: 'Reception signs a visitor in', verdict: 'works', by: 'Alex Lee', at: now - 900_000, note: 'Quick, as at the desk today' } },
  { id: 'J-02', title: 'The host approves an early arrival', steps: ['Open Visitors › Early arrivals', 'Click Approve', 'The visitor shows as approved'], start: { words: 'Open Visitors › Early arrivals' }, result: 'failed', marks: 0 },
  { id: 'J-03', title: 'A badge prints with the host’s name', steps: ['Open the visitor', 'Click Print badge', 'The badge shows the host’s name'], result: 'not-run', earlier: { status: 'passed', revision: OLD }, marks: 1, finding: { id: 'GV-2', revision: A, scenario: 'J-03', title: 'A badge prints with the host’s name', verdict: 'wrong', by: 'Alex Lee', at: now - 600_000, note: 'The host’s name is missing on the badge', correction: { id: 'CR-5', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ5' } } },
];
const VALIDATION = { floor: 'f1', revision: A, scenarios: SCENARIOS, checks: { passed: 12, failed: 0, skipped: 1 }, corrections: [{ id: 'CR-5', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ5', scenario: 'J-03', title: 'A badge prints with the host’s name', revision: A, at: now - 600_000 }] };
const REQUESTS = [{ id: 'CR-5', taskId: 'tsk_01JABCDEFGHJKMNPQRSTVWXYZ5', text: 'Something’s wrong…', by: 'Alex Lee', role: 'pm', member: 'Ada', delivery: 'sent', at: now - 600_000, revision: A, state: 'working', words: 'Being worked on', detail: 'The team is working on it.' }];

const DATA = {
  floor: 'f1',
  project: 'Visitor Registration',
  live: { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, started: true, branch: 'main', appPort: 8123, since: now - 600_000, served: { sha: A, subject: 'Host approval', builtAt: now - 540_000 } },
  appUrl: 'http://127.0.0.1:8123/',
  onScreen: A,
  business: { state: 'verification-incomplete', label: 'Verification incomplete', about: 'all', revision: A, revisionKind: 'served', version: 'v1', tone: 'busy', notes: [], missing: ['J-02 failed against 7d3f0b1', 'J-03 not run against 7d3f0b1'], line: '' },
  milestones: [],
  progress: { toolkit: false, done: 5, total: 6, acceptance: { version: 'v1', cycle: 1, earlier: [] } },
  brief: null,
  decisions: [],
  others: 0,
  changes: [],
  admin: true,
  requests: REQUESTS,
  validation: VALIDATION,
  delivery: { version: 'v1', commit: A },
};

const DRAFT = { reviewToken: 'a'.repeat(64), floor: 'f1', version: 'v1', scope: { agreed: [], delivered: [] }, source: { branch: 'main', commit: A, gaps: [] }, tests: [], docs: [], suggestions: [], cost: { spent: 1, at: now, byStage: [] }, admin: true };
const SECURITY = `Accepting this delivery needs the project's security baseline met at 7d3f0b1. Missing: No mx check at 7d3f0b1; Anonymous users are on. See App Insights › Security (Run mx check there), or change the project's security policy there with a reason. The office has started an mx check at 7d3f0b1 (it takes a few minutes): try again when it has finished.`;
const STALE = 'The delivery, its evidence or the budget changed since it was reviewed, so nothing was recorded. Look at the evidence again and confirm';

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import { createWorkspace } from './shell';
        import { pageAcceptance } from './validation-api';
        let data = {};
        const fns = new Set();
        window.__opened = []; window.__marks = []; window.__wants = []; window.__acted = 0; window.__markWith = undefined;
        const ws = createWorkspace({
          source: {
            get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {},
            request: async () => ({ ok: false, error: 'x' }),
            answer: async () => ({ ok: true }),
            want: (w) => window.__wants.push(w),
            mark: async (m) => (window.__marks.push(m), window.__markWith ?? { ok: true, finding: m.verdict === 'wrong' ? { correction: { id: 'CR-6', taskId: 't' } } : {} }),
            acceptance: pageAcceptance,
            acted: () => window.__acted++,
          },
          open: (t) => window.__opened.push(t),
        });
        document.querySelector('.lite-main').append(ws.el);
        window.__set = (d) => { data = d; fns.forEach((fn) => fn()); };
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

const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;color:#2f3646;background:#fff}header{background:#264ae5;color:#fff;padding:12px 16px;font-weight:600}main{padding:16px}</style></head><body><header>Visitor Registration · Reception</header><main><h2>Today's visitors</h2><p>Sam Doe · waiting for host</p></main></body></html>`;

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

async function open(page: Page, h: { js: string; css: string }, theme: string, posts: Posted[], answers: { status: number; body: object }[]) {
  await page.route('**/*', (r) => {
    const req = r.request();
    const u = req.url();
    if (u.startsWith('http://127.0.0.1:8123/')) return r.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE });
    if (u === 'http://office.test/lite') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>x</title>' });
    if (u.startsWith('http://office.test/api/acceptance/draft?floor=f1')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRAFT) });
    if (u.startsWith('http://office.test/api/acceptance?floor=f1')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ floor: 'f1', cycles: [{ n: 1, version: 'v1', record: { version: 'v1' } }], changed: [], chain: { ok: true }, admin: true }) });
    if (u === 'http://office.test/api/acceptance' && req.method() === 'POST') {
      posts.push({ url: u, body: JSON.parse(req.postData() ?? '{}') });
      const a = answers.shift() ?? { status: 200, body: { record: { version: 'v1' } } };
      return r.fulfill({ status: a.status, contentType: 'application/json', body: JSON.stringify(a.body) });
    }
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
const openAllSteps = (page: Page) => page.evaluate(() => document.querySelectorAll('.aw-scnsteps').forEach((d) => ((d as HTMLDetailsElement).open = true)));

test('in a browser: guided checks for the version on screen, marks, a correction, Accept through the existing path with its refusals, Reopen and the phone', { skip: chrome ? false : 'no Chromium here', timeout: 150_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const posts: Posted[] = [];
    const answers: { status: number; body: object }[] = [];
    await open(page, h, 'portal-light', posts, answers);
    await set(page, DATA);
    await show(page, 'review');

    // Review asks for guided validation only once it shows.
    assert.deepEqual(await get(page, '__wants'), ['validation']);
    // Each check with its result at this version; the earlier version's pass is only a note.
    assert.deepEqual(await page.$$eval('.aw-scn', (els) => els.map((e) => [e.getAttribute('data-scenario'), e.querySelector('.aw-pill')!.textContent])), [['J-01', 'Passed'], ['J-02', 'Failed'], ['J-03', 'Not run on this version']]);
    assert.match((await text(page, '.aw-scn[data-scenario="J-03"] .aw-earlier')) ?? '', /^Passed on an earlier version \(5e21c9d\); that doesn’t count for this one\.$/);
    assert.equal(await page.locator('.aw-scn[data-scenario="J-01"] .aw-earlier').count(), 0);
    assert.match((await text(page, '.aw-validation')) ?? '', /For version 7d3f0b1, the one running in the app[\s\S]*1 of 3 passed, 1 failed, 1 not run on this version; 1 marked working, 1 with something wrong[\s\S]*Automatic checks on this version: 12 passed, 1 didn’t run to the end\./);
    // The marks, and the correction with its request's state.
    assert.match((await text(page, '.aw-scn[data-scenario="J-01"] .aw-mark')) ?? '', /Works as expected marked by Alex Lee[\s\S]*Quick, as at the desk today/);
    assert.match((await text(page, '.aw-scn[data-scenario="J-03"] .aw-corr')) ?? '', /Sent to the team as CR-5 Being worked on/);
    // Steps in the journey's words, and where each starts.
    await openAllSteps(page);
    assert.deepEqual(await page.$$eval('.aw-scn[data-scenario="J-01"] .aw-steps li', (l) => l.map((x) => x.textContent)), SCENARIOS[0].steps);
    assert.match((await text(page, '.aw-scn[data-scenario="J-01"] summary')) ?? '', /4 steps · Starts on \/p\/Visitors/);
    assert.match((await text(page, '.aw-scn[data-scenario="J-02"] summary')) ?? '', /Starts with: Open Visitors › Early arrivals/);
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-01-review-light.png'), fullPage: true });

    // Works as expected: the dialog (✕ top right), Esc and ✕ give the focus back; then kept with the version.
    await page.focus('.aw-scn[data-scenario="J-02"] .aw-works');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aw-markdlg');
    assert.match((await text(page, '.aw-markdlg .aw-about')) ?? '', /CheckThe host approves an early arrival[\s\S]*Versionrunning 7d3f0b1[\s\S]*PageNo page: the app isn’t showing here/);
    const x = await page.evaluate(() => {
      const d = document.querySelector('.aw-markdlg')!.getBoundingClientRect();
      const b = document.querySelector('.aw-markdlg .close')!.getBoundingClientRect();
      return { right: d.right - b.right, top: b.top - d.top };
    });
    assert.ok(x.right < 40 && x.top < 40, `the ✕ is top right (${JSON.stringify(x)})`);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.aw-markdlg').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aw-works')), true, 'Esc: the focus is back');
    await page.keyboard.press('Enter');
    await page.click('.aw-markdlg .close');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aw-works')), true, '✕: the focus is back');
    await page.keyboard.press('Enter');
    await page.click('.aw-marksend');
    await page.waitForFunction(() => !document.querySelector('.aw-markdlg'));
    assert.deepEqual((await get<object[]>(page, '__marks'))[0], { revision: A, scenario: 'J-02', verdict: 'works' });
    assert.match((await text(page, '#toasts')) ?? '', /Marked “The host approves an early arrival” as working on this version/);

    // Try it: the App section, the canvas at the check's start page.
    await page.click('.aw-scn[data-scenario="J-01"] .aw-try');
    assert.equal((await get<string[]>(page, '__opened')).at(-1), 'app');
    await show(page, 'app');
    await page.waitForFunction(() => /\/p\/Visitors$/.test((document.querySelector('.aw-frame iframe') as HTMLIFrameElement | null)?.src ?? ''));

    // Something's wrong, with the page captured from the canvas: a note is needed; a refusal is shown; then sent.
    await show(page, 'review');
    await page.click('.aw-scn[data-scenario="J-02"] .aw-wrong');
    await page.waitForSelector('.aw-markdlg');
    assert.match((await text(page, '.aw-markdlg .aw-about')) ?? '', /Page\/p\/Visitors/);
    await page.click('.aw-marksend');
    assert.match((await text(page, '.aw-markdlg [role="alert"]')) ?? '', /Say what went wrong first/);
    await page.evaluate(() => ((window as unknown as { __markWith: unknown }).__markWith = { ok: false, status: 409, error: 'The app moved on to another version since you opened this check. Nothing was kept: look at the new version and mark it there.' }));
    await page.fill('.aw-markdlg .aw-reqtext', 'Approve does nothing for an early arrival');
    if (shots) await page.waitForTimeout(400), await page.screenshot({ path: path.join(shots, 'c5-02-something-wrong-light.png') });
    await page.click('.aw-marksend');
    await page.waitForFunction(() => /moved on to another version/.test(document.querySelector('.aw-markdlg [role="alert"]')?.textContent ?? ''));
    await page.evaluate(() => ((window as unknown as { __markWith: unknown }).__markWith = undefined));
    await page.click('.aw-marksend');
    await page.waitForFunction(() => !document.querySelector('.aw-markdlg'));
    assert.deepEqual((await get<object[]>(page, '__marks')).at(-1), { revision: A, scenario: 'J-02', verdict: 'wrong', note: 'Approve does nothing for an early arrival', page: '/p/Visitors' });
    assert.match((await text(page, '#toasts')) ?? '', /Sent to the team as CR-6: it shows under Requests with its state/);

    // No version on screen: nothing to try, said so.
    await set(page, { ...DATA, onScreen: undefined, validation: undefined, appUrl: undefined });
    assert.match((await text(page, '.aw-guided')) ?? '', /No version is running in the app right now/);
    await set(page, DATA);

    // Release: what's being accepted.
    await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
    await show(page, 'release');
    assert.deepEqual((await get<string[]>(page, '__wants')).slice(-2), ['validation', 'delivery']);
    const facts = (await text(page, '.aw-acceptcard .aw-facts')) ?? '';
    assert.match(facts, /Versionv1Deliverythe latest finished version, 7d3f0b1StatusVerification incomplete v1 · running 7d3f0b1Guided checks1 of 3 passed, 1 failed, 1 not run on this version; 1 marked working, 1 with something wrong \(version 7d3f0b1\)Open correctionsCR-5: A badge prints with the host’s name Being worked on/);
    assert.match((await text(page, '.aw-acceptcard')) ?? '', /Still missing for the next status:A guided check failed on this versionSome guided checks haven’t run on this version yet/);
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-03-release-light.png'), fullPage: true });

    // Accept: the existing path (GET the draft, POST /api/acceptance with its review token); the security gate refuses.
    answers.push({ status: 409, body: { error: SECURITY } });
    await page.focus('.aw-accept');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.aw-accdlg .aw-confirm');
    assert.match((await text(page, '.aw-accdlg .aw-ticks')) ?? '', /CR-5: A badge prints with the host’s name \(owner: Ada\)/);
    await page.click('.aw-acceptgo');
    assert.match((await text(page, '.aw-accdlg .aw-refusal')) ?? '', /Tick the confirmation first/);
    assert.equal(posts.length, 0, 'nothing sent without the confirmation');
    await page.check('.aw-accdlg .aw-confirm');
    await page.click('.aw-acceptgo');
    await page.waitForFunction(() => /security checks/.test(document.querySelector('.aw-accdlg .aw-refusal')?.textContent ?? ''));
    assert.equal(posts.length, 1);
    const { by: _by, ...sent } = posts[0].body;
    assert.deepEqual(sent, { floor: 'f1', action: 'accept', confirm: true, reviewToken: DRAFT.reviewToken, version: 'v1', exceptions: [{ text: 'CR-5: A badge prints with the host’s name', owner: 'Ada' }] }, 'the same body the progress bar’s dialog sends');
    assert.deepEqual(await page.$$eval('.aw-accdlg .aw-refusal li', (l) => l.map((x) => x.textContent)), ['No mx check at 7d3f0b1', 'Anonymous users are on', 'The office has started the security check. It takes a few minutes: try again when it has finished.']);
    if (shots) await page.waitForTimeout(400), await page.screenshot({ path: path.join(shots, 'c5-04-accept-refused-light.png') });
    // A stale review: said, the confirmation asked again.
    answers.push({ status: 409, body: { error: STALE, stale: true } });
    await page.click('.aw-acceptgo');
    await page.waitForFunction(() => /Something changed while you were looking/.test(document.querySelector('.aw-accdlg .aw-refusal')?.textContent ?? ''));
    assert.equal(await page.isChecked('.aw-accdlg .aw-confirm'), false, 'the confirmation is asked again');
    // Then it goes through: closed, said, the page asks again.
    await page.check('.aw-accdlg .aw-confirm');
    await page.click('.aw-acceptgo');
    await page.waitForFunction(() => !document.querySelector('.aw-accdlg'));
    assert.equal(posts.length, 3);
    assert.equal(await get(page, '__acted'), 1);
    assert.match((await text(page, '#toasts')) ?? '', /v1 accepted/);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('aw-accept')), true, 'the focus is back on Accept');

    // Accepted: Reopen, through the same path.
    await set(page, { ...DATA, business: { ...DATA.business, state: 'accepted', label: 'Business accepted', tone: 'good', missing: [] }, progress: { ...DATA.progress, acceptance: { version: 'v1', cycle: 1, earlier: [], accepted: { at: now, by: 'Alex Lee' } } } });
    assert.match((await text(page, '.aw-acceptcard h3')) ?? '', /v1 is accepted/);
    await page.click('.aw-reopen');
    await page.waitForSelector('.aw-accdlg .aw-reopengo');
    await page.click('.aw-reopengo');
    assert.match((await text(page, '.aw-accdlg .aw-refusal')) ?? '', /Say what the next version is for/);
    answers.push({ status: 200, body: { reopen: { version: 'v1.1', from: 'v1' } } });
    await page.fill('.aw-accdlg textarea', 'The badge carries the host’s name.');
    await page.click('.aw-reopengo');
    await page.waitForFunction(() => !document.querySelector('.aw-accdlg'));
    const { by: _b2, ...reopened } = posts.at(-1)!.body;
    assert.deepEqual(reopened, { floor: 'f1', action: 'reopen', version: 'v1.1', scopeNote: 'The badge carries the host’s name.' });
    assert.equal(await get(page, '__acted'), 2);

    // Not the Project Manager: the button isn't theirs, and says why.
    await set(page, { ...DATA, admin: false });
    assert.equal(await page.isDisabled('.aw-accept'), true);
    assert.match((await text(page, '.aw-acceptcard')) ?? '', /Only the Project Manager accepts a version\./);
    await set(page, DATA);

    await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
    // Dark.
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-05-release-dark.png'), fullPage: true });
    await show(page, 'review');
    await openAllSteps(page);
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-06-review-dark.png'), fullPage: true });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));

    // A phone: no sideways scrolling; the dialogs fit.
    await page.setViewportSize({ width: 400, height: 860 });
    await show(page, 'review');
    await page.waitForTimeout(100);
    let scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 400, `Review: no sideways scrolling at 400 px (${scroll})`);
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-07-phone-review-light.png'), fullPage: true });
    await page.click('.aw-scn[data-scenario="J-02"] .aw-wrong');
    await page.waitForSelector('.aw-markdlg');
    const dlg = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, w: document.querySelector('.aw-markdlg')!.getBoundingClientRect().width }));
    assert.ok(dlg.scroll <= 400 && dlg.w <= 400, `the dialog fits a phone (${JSON.stringify(dlg)})`);
    await page.keyboard.press('Escape');
    await show(page, 'release');
    await page.waitForTimeout(100);
    scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 400, `Release: no sideways scrolling at 400 px (${scroll})`);
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-08-phone-release-light.png'), fullPage: true });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c5-09-phone-release-dark.png'), fullPage: true });

    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
