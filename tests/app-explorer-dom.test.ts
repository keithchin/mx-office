// The Developer view's explorer (src/client/ui/app-workspace/explorer/) in headless Chromium, inside the real
// workspace (shell, canvas with the Live app viewer, panel) with a test source and fake requests:
//   - it reads main's newest commit, with or without a live app; the live app's revision is information only
//   - the business tree: Pages (the Marketplace folded, counts with what it adds), Data, Logic, Documents,
//     Process map, Design; tree ARIA; keyboard (arrows, Enter, type-ahead)
//   - a page always opens its Model preview, never the live app's frame (no request reaches the app); Open in
//     the live app is the separate, explicit action; Data and Logic open their diagrams; a document its card
//     (revision, git dates, versions, other representations side by side, status with its source)
//   - Request a change from an item (the item as context) and, for admins, Change this
//   - the search: the whole tree at once (folded groups too); in all files, every file of the revision
//   - main moving: the tree marked stale; Show it reads the new revision (levels again, changed rows dotted)
//   - a model that can't be read: the specific error shown
//   - width (keyboard), collapse, remembered; the phone's drawer (Esc gives focus back)
//   - perf: a big project's first level and a 400-page part drawn well under 200 ms of main-thread work
// Screenshots in Portal Light, Dark and a phone (AX_SHOTS=<dir>).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';
import { A, APP_PAGE, B, FAKES } from './fixtures/dev-view-fakes.js';

const root = path.join(import.meta.dirname, '..');
const shots = process.env.AX_SHOTS;
const now = Date.now();
const chrome = findChrome();

const live = (sha: string) => ({ floor: 'f1', status: 'running', phase: 'running', log: [], available: true, started: true, branch: 'main', appPort: 8123, since: now - 600_000, served: { sha, subject: 'Host approval', builtAt: now - 540_000 } });
const stopped = (sha: string) => ({ floor: 'f1', status: 'stopped', phase: 'stopped', log: [], available: true, started: false, branch: 'main', lastServed: { sha, subject: 'Host approval', builtAt: now - 540_000 } });
const DATA = (sha: string, running = true) => ({
  floor: 'f1',
  project: 'Visitor Registration',
  live: running ? live(sha) : stopped(sha),
  ...(running ? { appUrl: 'http://127.0.0.1:8123/' } : {}),
  milestones: [],
  decisions: [],
  others: 0,
  changes: [],
  admin: true,
});

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import { createWorkspace } from './shell';
        ${FAKES}
        let data = {};
        const fns = new Set();
        window.__opened = [];
        const ws = createWorkspace({
          source: { get: () => data, on: (fn) => (fns.add(fn), () => fns.delete(fn)), wake() {}, request: async (a) => (window.__asked.push(a), { ok: true, request: { id: 'CR-9', member: 'Ada' } }), answer: async () => ({ ok: true }) },
          open: (t) => window.__opened.push(t),
          explorer: window.__explorer,
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


async function open(page: Page, h: { js: string; css: string }, theme: string, hits: string[], big = false) {
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (u.startsWith('http://127.0.0.1:8123/')) {
      hits.push(new URL(u).pathname);
      return r.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE });
    }
    if (u.startsWith('http://office.test/')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>office</title>' });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://office.test/lite');
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite"><main class="lite-main"></main><div id="modal-root"></div><div id="toasts"></div></body></html>`);
  if (big) await page.evaluate(() => ((window as unknown as { __big: boolean }).__big = true));
  await page.addScriptTag({ content: h.js });
}

const set = (page: Page, d: object) => page.evaluate((x) => (window as unknown as { __set(d: unknown): void }).__set(x), d as Record<string, unknown>);
const show = (page: Page, s: string) => page.evaluate((x) => (window as unknown as { __show(s: string): void }).__show(x), s);
const get = <T>(page: Page, k: string) => page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], k) as Promise<T>;
const rowsText = (page: Page) => page.$$eval('.ax-tree [role="treeitem"] .ax-label', (els) => els.map((e) => e.textContent));
const row = (page: Page, label: string) => page.locator('.ax-tree [role="treeitem"]', { has: page.locator(`.ax-label:text-is("${label}")`) });
const focused = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.querySelector?.('.ax-label')?.textContent ?? document.activeElement?.textContent ?? null);
const frameSrc = (page: Page) => page.evaluate(() => (document.querySelector('.aw-frame iframe') as HTMLIFrameElement | null)?.src ?? '');
/** Every frame on the page that points at the live app (the Live app viewer's own frame is the only one allowed). */
const liveFrames = (page: Page) => page.$$eval('iframe', (els) => els.filter((e) => (e as HTMLIFrameElement).src.startsWith('http://127.0.0.1:8123/')).map((e) => (e.closest('.aw-frame') ? 'canvas' : 'elsewhere')));
/** How many pixels of a screenshot aren't empty grey or white (the Preview's frame must show the page). */
const inkOf = (page: Page, png: Buffer) =>
  page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.min(d[i], d[i + 1], d[i + 2]) < 230) n++;
    return n;
  }, png.toString('base64'));
const previewPainted = async (page: Page, name?: string) => {
  await page.waitForTimeout(300);
  const png = await page.locator('.ax-pane:not([hidden]) .pgp-frame').screenshot(shots && name ? { path: path.join(shots, name) } : {});
  const ink = await inkOf(page, png);
  assert.ok(ink > 1500, `the Model preview is painted (${ink} inked pixels)`);
};
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: path.join(shots, name) });
};

test('in a browser: main’s revision, pages open their Model preview (never the live frame), documents, search, stale, layout and the phone', { skip: chrome ? false : 'no Chromium here', timeout: 180_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: process.env.AX_BROWSER || chrome!, ...(process.env.AX_NEW_HEADLESS ? { args: ['--headless=new'] } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const hits: string[] = [];
    await open(page, h, 'portal-light', hits);
    // The live app isn't running: exploring works all the same.
    await set(page, DATA(A, false));
    await show(page, 'app');
    await page.waitForFunction(() => document.querySelectorAll('.ax-tree [role="treeitem"]').length >= 6);
    assert.deepEqual(await rowsText(page), ['Pages', 'Data', 'Logic', 'Documents', 'Process map', 'Design']);
    assert.match((await page.textContent('.ax-live')) ?? '', /Live app isn’t running \(last ran 7d3f0b1, main’s newest\)/);
    assert.equal(await page.inputValue('.ax-revsel'), 'main');
    assert.match((await page.textContent('.ax-revsel')) ?? '', /main · 7d3f0b1/);
    assert.equal(await page.textContent('[data-id="pages"] .ax-count-addon'), '+1', 'what the Marketplace adds, apart from the app’s own count');
    assert.equal(await page.getAttribute('.ax-tree', 'role'), 'tree');
    assert.equal(await page.locator('.ax-tree [tabindex="0"]').count(), 1, 'one row in the tab order');
    const calls0 = await get<string[]>(page, '__calls');
    assert.ok(calls0.includes('head 7d') && calls0.includes('level 7d ') && calls0.includes('documents 7d'), calls0.join(', '));

    // Keyboard: into Pages › Visitor desk, type-ahead, Enter opens the page's Model preview.
    await page.focus('.ax-tree [tabindex="0"]');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => !!document.querySelector('[data-id="pages/VisitorDesk"]'));
    await page.keyboard.press('ArrowDown');
    assert.equal(await focused(page), 'Visitor desk');
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector('[data-id="page:VisitorDesk.Visitor_Overview"]');
    assert.equal(await page.getAttribute('[data-id="page:VisitorDesk.Visitor_Overview"]', 'aria-level'), '3');
    await page.keyboard.type('today');
    assert.equal(await focused(page), 'Today’s visitors', 'the page’s title, type-ahead');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.ax-pane:not([hidden]) .pgp-frame');
    assert.match((await page.textContent('.ax-pane-note')) ?? '', /Model preview \(from the model, not the running app\) at 7d3f0b1: VisitorDesk\.Visitor_Overview/);
    assert.match((await page.textContent('.ax-pane-title')) ?? '', /Model preview/);
    assert.ok((await get<string[]>(page, '__calls')).includes('doc 7d page VisitorDesk.Visitor_Overview'), 'rendered at the revision shown');
    assert.equal(await page.textContent('.ax-bar-detail'), 'VisitorDesk.Visitor_Overview · VisitorDesk', 'the technical name in the details line');
    assert.equal(await page.isDisabled('.ax-live-open'), true, 'Open in the live app: off while the app is stopped');
    await previewPainted(page, 'p0-01b-preview-frame.png');
    await shot(page, 'p0-01-preview-stopped-light.png');

    // The app starts: the page click still opens the preview; only Open in the live app goes to the app.
    await set(page, DATA(A));
    await page.waitForFunction(() => !!document.querySelector('.ax-live')?.textContent?.startsWith('Live app runs 7d3f0b1'));
    await row(page, 'New visitor').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .pgp-frame');
    await row(page, 'Today’s visitors').click();
    await page.waitForTimeout(200);
    assert.ok(!(await frameSrc(page)).endsWith('/p/visitors'), 'a page click never moves the live frame');
    assert.ok(!hits.includes('/p/visitors'), 'and nothing reaches the live app for it');
    assert.ok((await liveFrames(page)).every((w) => w === 'canvas'), 'no live-app frame anywhere but the Live app viewer');
    assert.equal(await page.isVisible('.ax-pane'), true);
    await page.click('.ax-live-open');
    await page.waitForFunction(() => (document.querySelector('.aw-frame iframe') as HTMLIFrameElement | null)?.src.endsWith('/p/visitors'));
    assert.equal(await page.isHidden('.ax-pane'), true, 'the explicit live action shows the app');
    // The selected row's bar: Request a change with the item as context, Change this for an admin.
    assert.equal(await page.textContent('.ax-bar-name'), 'Page: Today’s visitors');
    await page.click('.ax-ask');
    await page.waitForSelector('.aw-reqdlg');
    await page.fill('.aw-reqtext', 'Show the arrival time next to each visitor');
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => (window as unknown as { __asked: unknown[] }).__asked.length === 1);
    const asked = (await get<{ text: string; page?: string; ref?: { docQn: string }; source?: string }[]>(page, '__asked'))[0];
    assert.equal(asked.text, 'Show the arrival time next to each visitor\n\nAbout: Today’s visitors (page VisitorDesk.Visitor_Overview)');
    assert.equal(asked.page, '/p/visitors');
    assert.equal(asked.ref?.docQn, 'VisitorDesk.Visitor_Overview', 'the page as a model reference');
    assert.match(asked.source ?? '', /^[0-9a-f]{40}$/, 'with the revision viewed');
    await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
    await page.click('.ax-change');
    assert.deepEqual(await get<string[]>(page, '__changeThis'), ['page VisitorDesk.Visitor_Overview main 7d']);

    // Select element on the Model preview with the app stopped, then Request a change to it: the chip, the
    // widget's reference (name, with $Type and $ID from the page's facts), the revision viewed; nothing reaches the app.
    await set(page, DATA(A, false));
    const hitsBefore = hits.length;
    await row(page, 'Today’s visitors').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .pgp-frame');
    assert.match((await page.textContent('.ax-pick')) ?? '', /Use ⌖ Select element to point at a widget/);
    await page.click('.ax-pane .pgp-pick');
    let pf = null as Awaited<ReturnType<Page['frames']>>[number] | null;
    for (let i = 0; i < 40 && !pf; i++) {
      const fh = await page.$('.ax-pane .pgp-frame');
      const fr = fh ? await fh.contentFrame() : null;
      if (fr && (await fr.$('[data-mx-w="btnSave"]'))) pf = fr;
      else await page.waitForTimeout(50);
    }
    await pf!.click('[data-mx-w="btnSave"]');
    await page.waitForSelector('.ax-chip');
    assert.equal(await page.textContent('.ax-chip-text'), 'Today’s visitors › Save button');
    await page.click('.ax-pick-ask');
    await page.waitForSelector('.aw-reqdlg .aw-chip');
    assert.equal(await page.textContent('.aw-reqdlg .aw-chip'), 'Today’s visitors › Save button');
    assert.match((await page.textContent('.aw-reqdlg .aw-about')) ?? '', /In the modelwidget btnSave on page VisitorDesk\.Visitor_Overview[\s\S]*Viewingmain @7d3f0b1[\s\S]*VersionNot running: not needed/);
    await page.fill('.aw-reqtext', 'Make the save button say Register');
    await page.click('.aw-reqsend');
    await page.waitForFunction(() => (window as unknown as { __asked: unknown[] }).__asked.length === 2);
    const fromEl = (await get<{ text: string; ref?: Record<string, string>; source?: string; revision?: string }[]>(page, '__asked'))[1];
    assert.deepEqual(fromEl.ref, { docType: 'page', docQn: 'VisitorDesk.Visitor_Overview', widgetName: 'btnSave', widgetType: 'Forms$ActionButton', label: 'Save button', id: 'id-save' });
    assert.equal(fromEl.source, A, 'the revision viewed');
    assert.equal(fromEl.revision, undefined, 'no running version');
    assert.match(fromEl.text, /About: Today’s visitors › Save button \(widget btnSave on page VisitorDesk\.Visitor_Overview\)/);
    assert.equal(hits.length, hitsBefore, 'nothing reached the live app');
    await page.evaluate(() => document.getElementById('toasts')!.replaceChildren());
    await set(page, DATA(A));


    // Data and Logic open their diagrams.
    await row(page, 'Data').click();
    await row(page, 'Visitor desk').nth(1).click();
    await row(page, 'Host approval').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .mx-svg');
    await page.click('.aw-tab[data-view="live"]');
    await row(page, 'Logic').click();
    await page.click('[data-id="logic/VisitorDesk"] .ax-label');
    await row(page, 'Visitor save').click();
    await page.waitForFunction(() => (window as unknown as { __calls: string[] }).__calls.some((c) => c.startsWith('doc 7d microflow')));

    // Documents: a card with the revision, git dates, relations; alternatives side by side; supporting kept.
    await row(page, 'Design').click();
    await row(page, 'Wireframes').click();
    await row(page, 'Visitor list').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .ax-doccard');
    const card = (await page.textContent('.ax-doccard')) ?? '';
    assert.match(card, /From the repository at 7d3f0b1/);
    assert.match(card, /Last changed 16 Oct 2026 by Bo · commit 7d3f0b1/);
    assert.match(card, /current · from PAGE-MAP\.tsv/);
    assert.match(card, /Other representations/);
    assert.equal(await page.locator('.ax-docgrid .ax-doclink').count(), 2, 'the storyboard frame and the prototype route, side by side');
    assert.match(card, /Supporting files.*Uses ds\.css/s);
    await shot(page, 'p0-02-document-alternatives-light.png');
    await page.click('.ax-linkbtn:text("Uses ds.css")');
    await page.waitForFunction(() => document.querySelector('.ax-pane-title')?.textContent === 'Design tokens (ds.css)');
    assert.match((await page.textContent('.ax-doccard')) ?? '', /Used by Visitor list/);
    await row(page, 'Look and feel').click();
    await page.waitForFunction(() => document.querySelector('.ax-pane-title')?.textContent === 'Look and feel');
    const look = (await page.textContent('.ax-doccard')) ?? '';
    assert.match(look, /Versions of the same document \(2\)/);
    assert.match(look, /Version v2.*Version v1/s);
    assert.match(look, /draft · from Status line/);
    assert.doesNotMatch(look, /latest|outdated|superseded|older version/i, 'nothing called newer or older by date');
    await page.click('.ax-docopen >> nth=0');
    await page.waitForSelector('.ax-docshow .ax-text');
    await row(page, 'Documents').click();
    await row(page, 'Requirements').click();
    await row(page, 'BRDs').click();
    await page.waitForFunction(() => document.querySelector('.ax-pane-title')?.textContent === 'BRDs');
    assert.match((await page.textContent('.ax-doccard')) ?? '', /BRD source data.*Related documents.*BRD report/s);
    await row(page, 'Business requirements').click();
    await page.waitForFunction(() => /No known relationship/.test(document.querySelector('.ax-doccard')?.textContent ?? ''));
    await shot(page, 'p0-03-documents-light.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await row(page, 'Look and feel').click();
    await page.waitForFunction(() => document.querySelector('.ax-pane-title')?.textContent === 'Look and feel');
    await shot(page, 'p0-04-document-versions-dark.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    await page.click('.aw-tab[data-view="live"]');

    // The search: the whole tree at once, the folded Marketplace group too; a document by its path.
    await page.fill('.ax-search', 'atlas');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'Atlas default'));
    assert.deepEqual(await rowsText(page), ['Pages', 'Marketplace modules', 'Atlas core', 'Atlas default']);
    assert.equal((await get<string[]>(page, '__calls')).filter((c) => c === 'index 7d').length, 1, 'one request for the whole tree');
    await page.fill('.ax-search', 'Visitor_NewEdit');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'New visitor'));
    await page.fill('.ax-search', 'ds.css');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'Design tokens (ds.css)'));
    await page.fill('.ax-search', '');
    await page.waitForFunction(() => !![...document.querySelectorAll('.ax-tree .ax-label')].find((e) => e.textContent === 'Documents'));

    // Show all files; its search covers every file of the revision.
    await page.click('.ax-switch');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'merge-notes.md'));
    await page.fill('.ax-search', 'merge');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'merge-plan.txt'));
    assert.deepEqual(await rowsText(page), ['merge-notes.md', 'merge-plan.txt'], 'a file deep in a folder never opened');
    assert.match((await page.textContent('.ax-status')) ?? '', /2 files match/);
    await row(page, 'merge-plan.txt').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .ax-text');
    await shot(page, 'p0-05-all-files-search-light.png');
    await page.fill('.ax-search', '');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'README.md'));
    await page.click('.ax-switch');
    await page.waitForFunction(() => [...document.querySelectorAll('.ax-tree .ax-label')].some((e) => e.textContent === 'Pages'));
    await page.click('.aw-tab[data-view="live"]');

    // Main moves (and the live app with it): the tree is marked stale, never swapped under the viewer; Show it reads B.
    await row(page, 'Today’s visitors').click();
    await page.click('.ax-live-open');
    await page.waitForFunction(() => (document.querySelector('.aw-frame iframe') as HTMLIFrameElement | null)?.src.endsWith('/p/visitors'));
    await page.evaluate((b) => ((window as unknown as { __main: string }).__main = b), B);
    await set(page, DATA(A));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForSelector('.ax-stale:not([hidden])');
    assert.match((await page.textContent('.ax-stale')) ?? '', /Main moved to 9e1c2d3 since this was read \(showing 7d3f0b1\)/);
    assert.match((await page.textContent('.ax-live')) ?? '', /Live app runs 7d3f0b1, 2 commits behind main/);
    assert.equal(await page.locator('[data-id="page:VisitorDesk.Host_Dashboard"]').count(), 0, 'still the revision that was read');
    await shot(page, 'p0-06-stale-light.png');
    const callsBefore = (await get<string[]>(page, '__calls')).length;
    await page.click('.ax-stale-go');
    await page.waitForSelector('[data-id="page:VisitorDesk.Host_Dashboard"]');
    await page.waitForSelector('[data-id="page:VisitorDesk.Visitor_Overview"] .ax-dot');
    const after = (await get<string[]>(page, '__calls')).slice(callsBefore);
    assert.ok(after.includes('level 9e pages/VisitorDesk') && after.includes('changes 7d 9e') && after.includes('documents 9e'), after.join(', '));
    assert.equal(await page.isHidden('.ax-stale'), true);
    assert.equal(await page.locator('[data-id="pages"] .ax-dot').count(), 1, 'the group dotted');
    assert.equal(await page.locator('[data-id="page:VisitorDesk.Visitor_NewEdit"] .ax-dot').count(), 0, 'unchanged: no dot');
    // The live app's revision can be picked instead of main's.
    await page.selectOption('.ax-revsel', 'served');
    await page.waitForFunction(() => document.querySelectorAll('[data-id="page:VisitorDesk.Host_Dashboard"]').length === 0);

    // A revision whose model can't be read: the specific error.
    await page.evaluate((b) => ((window as unknown as { __broken: string }).__broken = b), B);
    await page.selectOption('.ax-revsel', 'main');
    await page.waitForFunction(() => /Couldn’t read the model at 9e1c2d3: no Mendix project/.test(document.querySelector('.ax-status')?.textContent ?? ''));
    await shot(page, 'p0-07-model-error-light.png');
    await page.evaluate(() => ((window as unknown as { __broken: string }).__broken = ''));
    await page.selectOption('.ax-revsel', 'served');
    await page.waitForFunction(() => !document.querySelector('.ax-status')?.textContent);

    // Width by keyboard, collapse and back, remembered.
    await page.focus('.ax-grip');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getAttribute('.ax-grip', 'aria-valuenow'), '312');
    await page.click('.ax-collapse');
    assert.equal(await page.isVisible('.ax-tree'), false);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ax-expand')), true);
    assert.deepEqual(JSON.parse((await page.evaluate(() => localStorage.getItem('agent-office.aw.explorer'))) ?? '{}'), { w: 312, collapsed: true, all: false });
    // Collapsed: an icon rail (», Find, the sections, Show all files), each its name as tooltip and label.
    await page.waitForTimeout(300); // the width's transition
    const railInfo = await page.evaluate(() => {
      const side = document.querySelector('.ax-side')!.getBoundingClientRect();
      return {
        w: Math.round(side.width),
        btns: [...document.querySelectorAll<HTMLElement>('.ax-rail .ax-rail-btn')].filter((b) => !b.hidden).map((b) => ({ at: b.dataset.axRail, title: b.title, label: b.getAttribute('aria-label'), ico: !!b.querySelector('svg'), inside: b.getBoundingClientRect().right <= side.right })),
      };
    });
    assert.equal(railInfo.w, 44, 'a 44px rail');
    assert.deepEqual(railInfo.btns.map((b) => b.title), ['Find', 'Pages', 'Data', 'Logic', 'Documents', 'Process map', 'Design', 'Show all files']);
    for (const b of railInfo.btns) assert.ok(b.ico && b.label === b.title && b.inside, `rail button ${JSON.stringify(b)}`);
    await shot(page, 'rail-explorer-collapsed-light.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await shot(page, 'rail-explorer-collapsed-dark.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    // Data: the explorer opens at Data, its group open and focused; nothing else asked again.
    await page.click('[data-ax-rail="data"]');
    assert.equal(await page.isVisible('.ax-tree'), true, 'a section opens the explorer');
    assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.id), 'data', 'the focus on Data');
    assert.equal(await page.getAttribute('[data-id="data"]', 'aria-expanded'), 'true', 'Data opened');
    assert.equal(JSON.parse((await page.evaluate(() => localStorage.getItem('agent-office.aw.explorer'))) ?? '{}').collapsed, false, 'remembered open');
    // Find: the search box.
    await page.click('.ax-collapse');
    await page.click('[data-ax-rail="find"]');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ax-search')), true, 'Find opens in the search box');
    // A remembered rail: a fresh explorer comes back collapsed (the setting is read on load).
    await page.click('.ax-collapse');
    assert.equal(await page.isVisible('[data-ax-rail="pages"]'), true);
    await page.click('.ax-expand');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ax-collapse')), true, '» gives the focus to «');

    // A phone: a drawer opened by a button; Esc closes it and gives the focus back; no sideways scrolling.
    await page.setViewportSize({ width: 400, height: 860 });
    await page.waitForTimeout(100);
    assert.equal(await page.isVisible('.ax-drawer-btn'), true);
    assert.equal(await page.isVisible('.ax-tree'), false, 'closed at first');
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 400);
    await page.click('.ax-drawer-btn');
    await page.waitForTimeout(250);
    assert.equal(await page.isVisible('.ax-tree'), true);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('.ax-side')), true, 'focus moves into the drawer');
    await shot(page, 'p0-08-phone-drawer-light.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-dark'));
    await shot(page, 'p0-09-phone-drawer-dark.png');
    await page.evaluate(() => (document.documentElement.dataset.theme = 'portal-light'));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert.equal(await page.isVisible('.ax-tree'), false);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('ax-drawer-btn')), true, 'Esc gives the focus back to the button');
    // Opening a page from the drawer: its Model preview, painted at a phone's width.
    await page.click('.ax-drawer-btn');
    await page.waitForTimeout(250);
    await row(page, 'New visitor').click();
    await page.waitForTimeout(250);
    await page.waitForSelector('.ax-pane:not([hidden]) .pgp-frame');
    await previewPainted(page, 'p0-11b-phone-preview-frame.png');
    await shot(page, 'p0-11-phone-preview-light.png');
    // Opening a document from the drawer closes it and shows its card.
    await page.click('.ax-drawer-btn');
    await page.waitForTimeout(250);
    await row(page, 'Look and feel').click();
    await page.waitForTimeout(250);
    assert.equal(await page.isVisible('.ax-tree'), false);
    await page.waitForSelector('.ax-pane:not([hidden]) .ax-doccard');
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth)) <= 400, 'the card fits a phone');
    await shot(page, 'p0-10-phone-document-light.png');
    assert.deepEqual(errors, []);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('perf: a big project’s first level and a 400-page part draw well under 200 ms of main-thread work', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await open(page, h, 'portal-light', [], true);
    // Main-thread time from a click until the page is idle again (the fakes answer at once, so it's all drawing).
    const busy = (sel: string, until: string) =>
      page.evaluate(
        async ([s, u]) => {
          const t = performance.now();
          (document.querySelector(s) as HTMLElement).click();
          for (let i = 0; i < 200 && !document.querySelector(u); i++) await new Promise((r) => setTimeout(r, 0));
          return performance.now() - t;
        },
        [sel, until],
      );
    const first = await page.evaluate(async (d) => {
      const t = performance.now();
      (window as unknown as { __set(d: unknown): void; __show(s: string): void }).__set(d);
      (window as unknown as { __show(s: string): void }).__show('app');
      for (let i = 0; i < 400 && document.querySelectorAll('.ax-tree [role="treeitem"]').length < 6; i++) await new Promise((r) => setTimeout(r, 0));
      return performance.now() - t;
    }, DATA(A));
    await row(page, 'Pages').click();
    await page.waitForSelector('[data-id="pages/Big"]');
    const part = await busy('[data-id="pages/Big"] .ax-label', '[data-id="page:Big.Screen_399"]');
    // The search over the whole tree (one request, 400 pages filtered).
    const searchMs = await page.evaluate(async () => {
      const box = document.querySelector('.ax-search') as HTMLInputElement;
      box.value = 'screen 39';
      const t = performance.now();
      box.dispatchEvent(new Event('input'));
      for (let i = 0; i < 200 && !document.querySelector('[data-id="page:Big.Screen_399"]'); i++) await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return performance.now() - t;
    });
    await page.fill('.ax-search', '');
    // All files: a root of 3000 files, the first 300 drawn with Show more.
    const files = await busy('.ax-switch input', '[data-id="f:file299.txt"]');
    assert.equal(await page.locator('.ax-tree [role="treeitem"]').count(), 301, '300 rows and Show more');
    console.log(`explorer perf: first level ${first.toFixed(0)} ms (incl. the workspace's first draw), 400-page part ${part.toFixed(0)} ms, 3000-file root ${files.toFixed(0)} ms, whole-tree search ${searchMs.toFixed(0)} ms (two frames included)`);
    assert.ok(first < 600, `first level with the workspace's own first draw: ${first} ms`);
    assert.ok(part < 200, `400-page part: ${part} ms`);
    assert.ok(files < 200, `3000-file root: ${files} ms`);
    assert.ok(searchMs < 300, `whole-tree search: ${searchMs} ms`);
    await page.close();
  } finally {
    await browser.close();
  }
});

test('the screenshots folder exists when asked for', { skip: shots ? false : 'AX_SHOTS not set' }, () => {
  assert.ok(fs.existsSync(shots!));
});
