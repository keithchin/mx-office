// The App Workspace (C3, src/client/ui/app-workspace/) in headless Chromium, with the page's own styles and a
// test source in place of the page's feeds: its five sections, the canvas naming the served revision (and
// never a blank frame when nothing serves), the side panel's parts wired to the data and the marked slots
// for change requests, the empty states, the stage switch, the workspace switch
// (back to the Engineering page you came from, else the closest one), no engineering words in anything it
// draws, a phone width with no sideways scrolling, and Portal Light, Dark and phone screenshots
// (AW_SHOTS=<dir> saves them).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { bannedIn } from '../src/shared/app-workspace/words.js';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.AW_SHOTS;
const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const now = Date.now();

/** The full data: the app running, a status with what's missing, two decisions, progress, a brief, finished changes. */
const FULL = {
  floor: 'f1',
  project: 'Visitor Registration',
  live: { floor: 'f1', status: 'running', phase: 'running', log: [], available: true, started: true, branch: 'main', appPort: 8123, since: now - 600_000, served: { sha: A, subject: 'Host approval', builtAt: now - 540_000 } },
  appUrl: 'http://127.0.0.1:8123/',
  business: {
    state: 'verification-incomplete', label: 'Verification incomplete', about: 'all', revision: A, revisionKind: 'served', version: 'v1', tone: 'busy', notes: [],
    missing: [`no journey evidence for 7d3f0b1`, 'BUILD rows 4, 5 merged to main, not in the running build yet', 'unreviewed head: PR #12 merged without a review that counts'],
    line: 'Verification incomplete · running 7d3f0b1',
  },
  milestones: [
    { state: 'verification-passed', label: 'Verification passed', about: 'phase-1', title: 'Sign in at reception', tone: 'good', missing: [], notes: [], line: '' },
    { state: 'work-in-progress', label: 'Work in progress', about: 'phase-2', title: 'Badge printing', tone: 'busy', missing: [], notes: [], line: '' },
  ],
  progress: { toolkit: true, phase: '5', phaseTitle: 'Build', done: 6, total: 9, acceptance: { version: 'v1', cycle: 1, earlier: [] } },
  brief: { title: 'Visitor Registration', goal: ['Visitors sign in at reception, their host approves, and reception prints a badge.'], approved: 'Approved 2026-10-02 by Alex Lee', domains: ['Reception', 'Hosts', 'Badges'], questions: ['Should a host be able to approve from a phone?'] },
  decisions: [
    { id: 'esc:1', question: 'Can a host approve a visitor who arrives early?', detail: 'Reception sees early arrivals every morning.', since: now - 3_600_000, level: 'block' },
    { id: 'esc:2', question: 'Keep visitor records for 30 or 90 days?', level: 'warn' },
  ],
  others: 2,
  changes: [{ title: 'Host approval screen', at: new Date(now - 7_200_000).toISOString() }, { title: 'Reception sign-in list', at: new Date(now - 86_400_000).toISOString() }],
  autonomy: { level: 2, name: 'Guided', byStage: false },
  admin: true,
};

/** Nothing known or nothing there: the empty states. */
const EMPTY = { floor: 'f1', project: 'Visitor Registration', live: { floor: 'f1', status: 'stopped', log: [], available: true, started: true, lastServed: { sha: A, builtAt: now - 9e6, until: now - 3e6 } }, milestones: [], brief: null, decisions: [], others: 0, changes: [], admin: false };

const chrome = findChrome();

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
        window.__opened = [];
        window.__answered = [];
        window.__came = undefined;
        const ws = createWorkspace({
          source: { get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {}, request: async () => ({ ok: false, error: 'not here' }), answer: async () => ({ ok: true }) },
          open: (t) => window.__opened.push(t),
          cameFrom: () => window.__came,
        });
        document.querySelector('.lite-main').append(ws.el);
        window.__set = (d) => {
          data = { ...d, decisions: d.decisions && d.decisions.map((x) => ({ ...x, answer: () => window.__answered.push(x.id) })) };
          fns.forEach((fn) => fn());
        };
        window.__show = (s) => ws.show(s);
        window.__hide = () => ws.hide();`,
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

const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;color:#2f3646}header{background:#264ae5;color:#fff;padding:12px 16px;font-weight:600}main{padding:16px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}button{padding:6px 12px}</style></head><body><header>Visitor Registration · Reception</header><main><h2>Today's visitors</h2><table><tr><th>Visitor</th><th>Host</th><th>Status</th></tr><tr><td>Sam Doe</td><td>Alex Lee</td><td>Waiting for host</td></tr><tr><td>Kim Park</td><td>Jo Smith</td><td>Approved</td></tr></table><p><button>Sign in a visitor</button></p></main></body></html>`;

async function open(page: Page, h: { js: string; css: string }, theme: string) {
  await page.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1:8123/') ? r.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE }) : r.fulfill({ status: 404, body: '' })));
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite"><main class="lite-main"></main></body></html>`);
  await page.addScriptTag({ content: h.js });
}

const set = (page: Page, d: object) => page.evaluate((x) => (window as unknown as { __set(d: unknown): void }).__set(x), d as Record<string, unknown>);
const show = (page: Page, s: string) => page.evaluate((x) => (window as unknown as { __show(s: string): void }).__show(x), s);
const text = (page: Page, sel: string) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
/** Everything the workspace says: its text and its titles and labels. */
const words = (page: Page) => page.evaluate(() => {
  const el = document.querySelector('.aw')!;
  const attrs = [...el.querySelectorAll('[title],[aria-label]')].flatMap((e) => [e.getAttribute('title') ?? '', e.getAttribute('aria-label') ?? '']);
  return [(el as HTMLElement).innerText, ...attrs].join('\n');
});

test('in a browser: sections, canvas, panel, stages, switch, empty states, words and the phone', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, h, 'portal-light');
    await set(page, FULL);
    await show(page, 'app');

    // The five sections, App on.
    assert.deepEqual(await page.$$eval('.aw-tab', (b) => b.map((x) => x.textContent)), ['App', 'Requirements', 'Decisions', 'Review', 'Release']);
    assert.equal(await page.getAttribute('.aw-tab[data-section="app"]', 'aria-current'), 'page');
    assert.equal(await text(page, '.aw-crumb'), 'Visitor Registration · App workspace');
    // The canvas: the running app in its frame, the served revision named, Open in a new tab always there.
    assert.equal(await page.locator('.aw-frame iframe').count(), 1);
    assert.match((await text(page, '.aw-runline')) ?? '', /Running version 7d3f0b1 · ready since/);
    assert.equal(await page.getAttribute('.aw-open', 'href'), 'http://127.0.0.1:8123/');
    // The panel: the shared status with its version, in business words; the decision; progress; changes; the slot.
    assert.equal(await text(page, '[data-part="status"] .aw-pill'), 'Verification incomplete');
    assert.equal(await text(page, '[data-part="status"] .aw-ver'), 'v1 · running 7d3f0b1');
    assert.deepEqual(await page.$$eval('[data-part="status"] .aw-small', (p) => p.map((x) => x.textContent)), ['No guided check has run on this version yet', 'Some agreed work isn’t in the running app yet']);
    assert.equal(await text(page, '[data-part="decision"] .aw-q'), 'Can a host approve a visitor who arrives early?');
    assert.match((await text(page, '[data-part="progress"]')) ?? '', /6 of 9 steps done · now: Build/);
    assert.match((await text(page, '[data-part="changes"]')) ?? '', /Host approval screen/);
    assert.match((await text(page, '[data-part="request"]')) ?? '', /Reading your requests/, 'C4: the current request (none read here)');
    assert.equal(await text(page, '[data-part="next"] .aw-primary'), 'Answer the decision');
    assert.match((await text(page, '.aw-foot')) ?? '', /The team works at 2 Guided · change/);
    // The stage: Building, marked Now: the plan is still at its build step (the progress line says the same).
    assert.equal(await text(page, '.aw-stage.now'), 'BuildingNow');
    assert.equal(await page.locator('.aw-stage').count(), 5, 'Awaiting approval only under an approval policy');
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-01-app-light.png') });
    let w = await words(page);
    assert.deepEqual(bannedIn(w), [], `no engineering words on App: ${bannedIn(w)}`);

    // The stage switch shows what another stage is about, and goes back.
    await page.click('.aw-stage[data-stage="released"]');
    assert.match((await text(page, '.aw-stagenote')) ?? '', /^Released: the page shows the released version; .*This project is at Building/);
    assert.equal(await page.locator('.aw-frame iframe').count(), 1, 'peeking at a stage changes no data');
    await page.click('.aw-stagenote .aw-link');
    assert.equal(await page.isHidden('.aw-stagenote'), true);

    // The section bar and the switch go through the page's own opener.
    await page.click('.aw-tab[data-section="decisions"]');
    await page.click('.aw-seg[data-ws="eng"]');
    await page.evaluate(() => ((window as unknown as { __came: string }).__came = 'board'));
    await page.click('.aw-seg[data-ws="eng"]');
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened), ['decisions', 'live', 'board'], 'App → Engineering: the closest page, else where you came from');

    // Every section, in business words; the slots marked; Answer goes through the decision's own way.
    for (const s of ['requirements', 'decisions', 'review', 'release']) {
      await show(page, s);
      assert.equal(await page.getAttribute(`.aw-tab[data-section="${s}"]`, 'aria-current'), 'page');
      assert.equal(await page.locator('.aw-frame iframe').count(), 0, `${s}: the page in place of the canvas`);
      w = await words(page);
      assert.deepEqual(bannedIn(w), [], `${s}: ${bannedIn(w)}`);
      if (shots && s === 'decisions') await page.screenshot({ path: path.join(shots, 'c3-02-decisions-light.png') });
      if (shots && s === 'review') await page.screenshot({ path: path.join(shots, 'c3-03-review-light.png') });
    }
    await show(page, 'requirements');
    assert.match((await text(page, '.aw-page')) ?? '', /Visitors sign in at reception[\s\S]*Reception[\s\S]*approve from a phone/);
    await show(page, 'decisions');
    assert.equal(await page.locator('.aw-decision').count(), 2);
    await page.click('.aw-decision >> nth=0 >> button:has-text("Answer")');
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __answered: string[] }).__answered), ['esc:1']);
    assert.match((await text(page, '.aw-page')) ?? '', /2 more items wait on someone/);
    await show(page, 'review');
    assert.match((await text(page, '.aw-page')) ?? '', /Sign in at receptionVerification passed[\s\S]*Guided checks on this version[\s\S]*No version is running in the app right now/);
    await show(page, 'release');
    assert.match((await text(page, '.aw-page')) ?? '', /Accept this version[\s\S]*Versionv1[\s\S]*No deployment recorded/);

    // Dark.
    await show(page, 'app');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-04-app-dark.png') });
    await show(page, 'decisions');
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-05-decisions-dark.png') });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));

    // Empty states: no frame at all when nothing serves; each part says what will appear.
    await set(page, EMPTY);
    await show(page, 'app');
    assert.equal(await page.locator('.aw-frame iframe').count(), 0, 'nothing serves: no frame, never a blank one');
    assert.match((await text(page, '.aw-canvas-empty')) ?? '', /The app isn’t running right now[\s\S]*Last ran version 7d3f0b1[\s\S]*Start the app/);
    assert.match((await text(page, '[data-part="status"]')) ?? '', /Working out the status/);
    assert.match((await text(page, '[data-part="decision"]')) ?? '', /Nothing waits on you right now/);
    assert.match((await text(page, '[data-part="changes"]')) ?? '', /Finished changes show here/);
    assert.match((await text(page, '[data-part="progress"]')) ?? '', /Reading the project’s progress/);
    assert.equal(await page.locator('.aw-foot .aw-link').count(), 0, 'not an admin: no change link');
    await page.click('.aw-canvas-empty button');
    assert.equal((await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).at(-1), 'live', 'Start the app: the Live app page, with its own checks');
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-06-app-not-running-light.png') });
    for (const s of ['app', 'requirements', 'decisions', 'review', 'release']) {
      await show(page, s);
      w = await words(page);
      assert.deepEqual(bannedIn(w), [], `${s} (empty): ${bannedIn(w)}`);
    }
    await show(page, 'requirements');
    assert.match((await text(page, '.aw-page')) ?? '', /No brief yet/);
    await show(page, 'decisions');
    assert.match((await text(page, '.aw-page')) ?? '', /Nothing waits on you\. When the team needs a decision/);

    // A phone: the panel under the canvas, no sideways scrolling.
    await page.setViewportSize({ width: 400, height: 860 });
    await set(page, FULL);
    await show(page, 'app');
    await page.waitForTimeout(100);
    const phone = await page.evaluate(() => {
      const main = document.querySelector('.aw-main')!.getBoundingClientRect();
      const side = document.querySelector('.aw-side')!.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, below: side.top >= main.bottom - 1, sideW: side.width };
    });
    assert.ok(phone.scroll <= 400, `no sideways scrolling at 400 px (${phone.scroll})`);
    assert.ok(phone.below, 'the panel stacks under the canvas');
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-07-phone-light.png'), fullPage: true });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-08-phone-dark.png'), fullPage: true });

    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('the screenshots folder exists when asked for', { skip: shots ? false : 'AW_SHOTS not set' }, () => {
  assert.ok(fs.existsSync(shots!));
});
