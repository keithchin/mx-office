// The Developer view's shell (src/client/ui/app-workspace/shell.ts) in headless Chromium, with the page's own
// styles and a test source in place of the page's feeds, and no chat on the page: the canvas's two views (Model
// preview by default, Live preview naming the served revision, never a blank frame when nothing serves, "not
// running" in its tab), no section tabs and no status panel (they moved to Project Management), the project's
// name, a phone width with no sideways scrolling, and Portal Light, Dark and phone screenshots (AW_SHOTS=<dir>).
// The docked chat is tests/docked-chat-dom.test.ts; the switch is tests/view-switch-dom.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

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
        const ws = createWorkspace({
          source: { get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {}, request: async () => ({ ok: false, error: 'not here' }), answer: async () => ({ ok: true }) },
          open: (t) => window.__opened.push(t),
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
test('in a browser: the canvas’s two views, no sections or status panel, empty states and the phone', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await open(page, h, 'portal-light');
    await set(page, FULL);
    await show(page, 'app');

    // The bar: the project's name and the canvas's two views; no section tabs, no status panel.
    assert.equal(await text(page, '.aw-crumb'), 'Visitor Registration · Developer view');
    assert.equal(await page.getAttribute('.aw', 'aria-label'), 'Developer view');
    assert.deepEqual(await page.$$eval('.aw-views .aw-tab', (b) => b.map((x) => x.textContent)), ['Model preview', 'Live preview']);
    assert.equal(await page.getAttribute('.aw-tab[data-view="model"]', 'aria-selected'), 'true', 'the Model preview is the default');
    assert.equal(await page.locator('.aw-tab[data-section], .aw-side, [data-part]').count(), 0, 'no sections, no status panel');
    assert.equal(await page.locator('.aw .aw-switch, .aw .aw-seg').count(), 0, 'the view switch is the top bar’s, not the workspace’s');
    // The live frame isn't on screen until Live preview is picked.
    assert.equal(await page.isVisible('.aw-frame'), false);
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-01-model-light.png') });

    // Live preview: the running app in its frame, the served revision named, Open in a new tab always there.
    await page.click('.aw-tab[data-view="live"]');
    assert.equal(await page.getAttribute('.aw-tab[data-view="live"]', 'aria-selected'), 'true');
    assert.equal(await page.locator('.aw-frame iframe').count(), 1);
    assert.match((await text(page, '.aw-runline')) ?? '', /Running version 7d3f0b1 · ready since/);
    assert.equal(await page.getAttribute('.aw-open', 'href'), 'http://127.0.0.1:8123/');
    assert.equal(await text(page, '.aw-tab[data-view="live"]'), 'Live preview');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-02-live-dark.png') });
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));

    // Nothing serves: no frame at all; the tab says not running; Start the app goes to the Live app page.
    await set(page, EMPTY);
    assert.equal(await page.locator('.aw-frame iframe').count(), 0, 'nothing serves: no frame, never a blank one');
    assert.equal(await text(page, '.aw-tab[data-view="live"]'), 'Live preview · not running');
    assert.match((await text(page, '.aw-canvas-empty')) ?? '', /The app isn’t running right now[\s\S]*Last ran version 7d3f0b1[\s\S]*Start the app/);
    await page.click('.aw-canvas-empty button');
    assert.equal((await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).at(-1), 'live', 'Start the app: the Live app page, with its own checks');
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-03-not-running-light.png') });

    // A phone: no sideways scrolling.
    await page.setViewportSize({ width: 400, height: 860 });
    await set(page, FULL);
    await page.waitForTimeout(100);
    const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scroll <= 400, `no sideways scrolling at 400 px (${scroll})`);
    if (shots) await page.screenshot({ path: path.join(shots, 'c3-04-phone-light.png'), fullPage: true });

    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('the screenshots folder exists when asked for', { skip: shots ? false : 'AW_SHOTS not set' }, () => {
  assert.ok(fs.existsSync(shots!));
});
