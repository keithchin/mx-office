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

const root = path.join(import.meta.dirname, '..');
const shots = process.env.AX_SHOTS;
const A = '7d3f0b1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = '9e1c2d3bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
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

// The fake server: main's newest commit, the business tree at A and B, the files, the documents, the Model tab's documents.
const FAKES = `
  const P = (qn, url, title) => ({ id: 'page:' + qn, label: title || qn.split('.')[1].replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase()), kind: 'page', type: 'page', qn, key: 'page:' + qn, detail: qn + ' · ' + qn.split('.')[0], hint: 'A page of the app: ' + qn + (url ? ' · in the running app at ' + url : ' · opens from another page'), ...(url ? { url } : {}) });
  const tree = (rev, at) => {
    const big = window.__big;
    const L = {
      '': [
        { id: 'pages', label: 'Pages', kind: 'group', folder: true, count: big ? 402 : rev === '${B}' ? 3 : 2, addonCount: 1, hint: 'The screens of the app. 2 pages in the app’s own modules; Marketplace modules add 1 more (3 in all).' },
        { id: 'data', label: 'Data', kind: 'group', folder: true, count: 2, hint: 'What the app keeps' },
        { id: 'logic', label: 'Logic', kind: 'group', folder: true, count: 1, hint: 'What the app does' },
      ],
      pages: [{ id: 'pages/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 2 }, ...(big ? [{ id: 'pages/Big', label: 'Big part', kind: 'module', folder: true, count: 400 }] : []), { id: 'pages/@marketplace', label: 'Marketplace modules', kind: 'module', folder: true, count: 1, addon: true }],
      'pages/@marketplace': [{ id: 'pages/Atlas_Core', label: 'Atlas core', kind: 'module', folder: true, count: 1, addon: true }],
      'pages/VisitorDesk': [...(rev === '${B}' ? [P('VisitorDesk.Host_Dashboard', '/p/host', 'Host dashboard')] : []), P('VisitorDesk.Visitor_NewEdit', undefined, 'New visitor'), P('VisitorDesk.Visitor_Overview', '/p/visitors', 'Today’s visitors')],
      'pages/Big': Array.from({ length: 400 }, (_, i) => P('Big.Screen_' + String(i).padStart(3, '0'), '/p/s' + i)),
      'pages/Atlas_Core': [P('Atlas_Core.Atlas_Default')],
      data: [{ id: 'data/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 2, type: 'domainmodel', qn: 'VisitorDesk', key: 'domainmodel:VisitorDesk' }],
      'data/VisitorDesk': [{ id: 'entity:VisitorDesk.HostApproval', label: 'Host approval', kind: 'entity', type: 'entity', qn: 'VisitorDesk.HostApproval', key: 'domainmodel:VisitorDesk', hint: 'A kind of record the app keeps' }, { id: 'entity:VisitorDesk.Visitor', label: 'Visitor', kind: 'entity', type: 'entity', qn: 'VisitorDesk.Visitor', key: 'domainmodel:VisitorDesk', hint: 'A kind of record the app keeps' }],
      logic: [{ id: 'logic/VisitorDesk', label: 'Visitor desk', kind: 'module', folder: true, count: 1 }],
      'logic/VisitorDesk': [{ id: 'microflow:VisitorDesk.ACT_Visitor_Save', label: 'Visitor save', kind: 'flow', type: 'microflow', qn: 'VisitorDesk.ACT_Visitor_Save', key: 'microflow:VisitorDesk.ACT_Visitor_Save', hint: 'Logic that runs on the server' }],
    };
    if (window.__broken === rev) return at === '' ? { rev, at, nodes: [], problem: 'Couldn’t read the model at ' + rev.slice(0, 7) + ': no Mendix project (.mpr) in this commit' } : { rev, at, nodes: [] };
    if (at === '*') return L;
    if (!(at in L)) throw new Error('No such part of the tree');
    return { rev, at, nodes: L[at] };
  };
  const files = (rev, p, cursor) => {
    if (window.__big && p === '') {
      const all = Array.from({ length: 3000 }, (_, i) => ({ id: 'f:file' + i + '.txt', label: 'file' + i + '.txt', kind: 'file', path: 'file' + i + '.txt', key: 'file' + i + '.txt', size: 10 }));
      return { rev, at: p, nodes: all.slice(cursor, cursor + 300), total: 3000, next: cursor + 300 < 3000 ? cursor + 300 : undefined };
    }
    const L = {
      '': [{ id: 'f:docs/', label: 'docs', kind: 'folder', folder: true, path: 'docs', count: 1 }, { id: 'f:javasource/', label: 'javasource', kind: 'folder', folder: true, path: 'javasource', count: 1 }, { id: 'f:App.mpr', label: 'App.mpr', kind: 'file', path: 'App.mpr', key: 'App.mpr' }, { id: 'f:merge-notes.md', label: 'merge-notes.md', kind: 'file', path: 'merge-notes.md', key: 'merge-notes.md' }, { id: 'f:README.md', label: 'README.md', kind: 'file', path: 'README.md', key: 'README.md' }],
      docs: [{ id: 'f:docs/brd.md', label: 'brd.md', kind: 'file', path: 'docs/brd.md', key: 'docs/brd.md' }],
      javasource: [{ id: 'f:javasource/GitHelper.java', label: 'GitHelper.java', kind: 'file', path: 'javasource/GitHelper.java', key: 'javasource/GitHelper.java' }],
    };
    return { rev, at: p, nodes: L[p] ?? [], total: (L[p] ?? []).length };
  };
  const C = (sha, day, author) => ({ sha, at: Date.UTC(2026, 9, day), author, subject: 'work' });
  const F = (path, last, extra) => ({ path, kind: path.endsWith('.md') ? 'md' : path.endsWith('.png') ? 'image' : path.endsWith('.css') ? 'text' : path.endsWith('.json') ? 'json' : 'html', size: 10, last, ...(extra || {}) });
  const DOCS = (rev) => ({ rev, counts: { version: 2, alternative: 3, supporting: 2, related: 2, run: 0, unknown: 2, files: 11, entries: 9 }, entries: [
    { id: 'd:docs/brd.md', title: 'Business requirements', group: 'documents', section: 'Requirements', shape: 'single', files: [F('docs/brd.md', C('${A}', 16, 'Ada'))], relations: ['unknown'], links: [] },
    { id: 'd:analysis/brd-report.html', title: 'BRD report', group: 'documents', section: 'Requirements', shape: 'single', role: 'BRD report', files: [F('analysis/brd-report.html', C('${A}', 17, 'Ada'))], relations: ['related'], links: [{ relation: 'related', to: 'd:analysis/f001.brd.json', label: 'BRD source data' }] },
    { id: 'd:analysis/f001.brd.json', title: 'BRDs', group: 'documents', section: 'Requirements', shape: 'single', role: 'BRD source data', files: [F('analysis/F001.brd.json', C('${A}', 15, 'Ada'))], relations: ['related'], links: [{ relation: 'related', to: 'd:analysis/brd-report.html', label: 'BRD report' }] },
    { id: 'd:docs/process.html', title: 'Visitor process', group: 'processmap', section: 'Design', shape: 'single', files: [F('docs/process.html', C('${A}', 16, 'Bo'))], relations: ['unknown'], links: [] },
    { id: 'd:design/look.md', title: 'Look and feel', group: 'design', section: 'Design', shape: 'versions', files: [F('design/look-v2.md', C('${A}', 18, 'Bo'), { marker: 'v2', status: { value: 'draft', text: 'Stage 3 draft for review', source: 'Status line' } }), F('design/look-v1.md', C('${A}', 14, 'Cy'), { marker: 'v1' })], relations: ['version'], links: [] },
    { id: 'd:design/wireframes/visitor_list.html', title: 'Visitor list', group: 'design', section: 'Design', set: 'Wireframes (one per screen)', shape: 'single', role: 'Wireframe', files: [F('design/wireframes/Visitor_List.html', C('${A}', 16, 'Bo'), { status: { value: 'current', text: 'mapped to page Visitor_List', source: 'PAGE-MAP.tsv' } })], relations: ['alternative', 'supporting'], links: [{ relation: 'alternative', to: 'd:design/storyboard/01-visitor_list.png', label: 'Storyboard frame of Visitor list' }, { relation: 'alternative', to: 'd:design/prototype.html', label: 'Prototype of Visitor list (#/visitors)', route: '#/visitors' }, { relation: 'supporting', to: 'd:design/ds.css', label: 'Uses ds.css' }] },
    { id: 'd:design/storyboard/01-visitor_list.png', title: 'Visitor list', group: 'design', section: 'Design', set: 'Storyboard', shape: 'single', role: 'Storyboard frame', files: [F('design/storyboard/01-Visitor_List.png', C('${A}', 15, 'Bo'))], relations: ['alternative'], links: [{ relation: 'alternative', to: 'd:design/wireframes/visitor_list.html', label: 'Wireframe of Visitor list' }] },
    { id: 'd:design/prototype.html', title: 'Prototype', group: 'design', section: 'Design', shape: 'single', role: 'Prototype', files: [F('design/prototype.html', C('${A}', 18, 'Cy'))], relations: ['alternative'], links: [{ relation: 'alternative', to: 'd:design/wireframes/visitor_list.html', label: 'Wireframe of Visitor list' }] },
    { id: 'd:design/ds.css', title: 'Design tokens (ds.css)', group: 'design', section: 'Design', shape: 'single', role: 'Design tokens', files: [F('design/ds.css', C('${A}', 16, 'Bo'))], relations: ['supporting'], links: [{ relation: 'supporting', to: 'd:design/wireframes/visitor_list.html', label: 'Used by Visitor list' }] },
  ] });
  window.__main = '${A}';
  window.__calls = [];
  window.__asked = [];
  window.__changeThis = [];
  const api = {
    level: async (f, rev, at) => (window.__calls.push('level ' + rev.slice(0, 2) + ' ' + at), tree(rev, at)),
    folder: async (f, rev, p, c) => (window.__calls.push('folder ' + rev.slice(0, 2) + ' ' + p), files(rev, p, c || 0)),
    file: async (f, rev, p) => (p.endsWith('.png') ? { path: p, size: 12, kind: 'image', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' } : { path: p, size: 12, kind: 'text', text: 'The text of ' + p }),
    changes: async (f, a, b) => (window.__calls.push('changes ' + a.slice(0, 2) + ' ' + b.slice(0, 2)), { from: a, to: b, docs: ['page:VisitorDesk.Visitor_Overview', 'page:VisitorDesk.Host_Dashboard'], files: ['docs/brd.md'] }),
    head: async (f, served) => (window.__calls.push('head ' + (served || '').slice(0, 2)), { rev: window.__main, branch: 'main', subject: 'Host approval', ...(served ? { served: { sha: served, behind: served === window.__main ? 0 : 2, ahead: 0 } } : {}) }),
    index: async (f, rev) => (window.__calls.push('index ' + rev.slice(0, 2)), { rev, levels: tree(rev, '*') }),
    search: async (f, rev, q) => {
      window.__calls.push('search ' + q);
      const hits = ['README.md', 'merge-notes.md', 'docs/brd.md', 'javasource/GitHelper.java', 'deep/a/b/c/merge-plan.txt'].filter((p) => p.includes(q));
      return { rev, q, total: hits.length, nodes: hits.map((p) => ({ id: 'f:' + p, label: p.split('/').pop(), kind: 'file', path: p, key: p, detail: p, hint: p })) };
    },
    documents: async (f, rev) => (window.__calls.push('documents ' + rev.slice(0, 2)), DOCS(rev)),
  };
  const PAGE_MDL = "create or modify page VisitorDesk.Visitor_NewEdit (\\n  Title: 'Visitor',\\n  Layout: Atlas_Core.Atlas_Default\\n) {\\n  dataview dv (DataSource: $Visitor) {\\n    textbox tbName (Label: 'Name', Attribute: Name)\\n    actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary)\\n  }\\n}";
  const model = { doc: async (f, rev, type, qn) => {
    window.__calls.push('doc ' + rev.slice(0, 2) + ' ' + type + ' ' + qn);
    if (type === 'domainmodel') return { sha: rev, doc: { kind: 'domainmodel', module: qn, source: 'units', associations: [], annotations: [], entities: [{ id: 'e1', name: 'Visitor', kind: 'persistent', x: 20, y: 20, attrs: [{ name: 'Name', type: 'String' }] }, { id: 'e2', name: 'HostApproval', kind: 'persistent', x: 260, y: 20, attrs: [{ name: 'ApprovedAt', type: 'Date and time' }] }] } };
    if (type === 'microflow') return { sha: rev, doc: { kind: 'microflow', name: qn, nodes: [], edges: [], mdl: '', source: 'units' } };
    if (type === 'page') return { sha: rev, doc: { kind: 'text', type: 'page', name: qn, mdl: PAGE_MDL } };
    return { sha: rev, doc: { kind: 'text', type, name: qn, mdl: '' } };
  } };
  window.__explorer = { api, changeThis: (o) => window.__changeThis.push(o.kind + ' ' + o.qn + ' ' + o.ref + ' ' + o.sha.slice(0, 2)), model };
`;

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

const APP_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font:14px system-ui;color:#2f3646}header{background:#264ae5;color:#fff;padding:12px 16px;font-weight:600}main{padding:16px}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style></head><body><header>Visitor Registration</header><main><h2>Today's visitors</h2><table><tr><th>Visitor</th><th>Host</th></tr><tr><td>Sam Doe</td><td>Alex Lee</td></tr><tr><td>Kim Park</td><td>Jo Smith</td></tr></table></main></body></html>`;

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

    // Data and Logic open their diagrams.
    await row(page, 'Data').click();
    await row(page, 'Visitor desk').nth(1).click();
    await row(page, 'Host approval').click();
    await page.waitForSelector('.ax-pane:not([hidden]) .mx-svg');
    await page.click('.ax-back');
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
    await page.click('.ax-back');

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
    await page.click('.ax-back');

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
    await page.click('.ax-expand');

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
