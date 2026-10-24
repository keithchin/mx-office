// The Developer | Project Management switch (src/client/ui/app-workspace/view-switch.ts) in headless Chromium,
// on the 1D view's own top bar (lite.html's header, with Go to Office and, in Portal, the Portal bar's pieces)
// and the page's own styles: it stands at the same place and size on a Project Management tab and in the
// Developer view (bounding boxes measured) in Portal Light, Portal Dark, Clean and the Default look, at desktop
// and phone width; it marks the view showing, opens tabs only through the page's opener (the project stays:
// no navigation), goes back to the page you came from, and moves with ← / →. The real page, a test office and
// the old links are scripts/view-switch-shots.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const chrome = findChrome();
const lite = fs.readFileSync(path.join(root, 'src/client/lite.html'), 'utf8');
const header = /<header class="lite-bar">[\s\S]*?<\/header>/.exec(lite)![0];
const mainPart = /<main class="lite-main">[\s\S]*?<\/main>/.exec(lite)![0];

async function harness(): Promise<{ js: string; css: string }> {
  const out = await build({
    stdin: {
      contents: `import '../../lite.css';
        import '../../styles/themes.css';
        import '../../styles/theme-clean.css';
        import '../../styles/theme-portal.css';
        import '../flatchrome.css';
        import '../portal/layout.css';
        import { portalBar } from '../portal/topbar';
        import { goToOfficeButton } from '../viewpick';
        import { createWorkspace } from './shell';
        import { viewSwitch, placeViewSwitch } from './view-switch';
        import { isAppSection } from '../../../shared/app-workspace/route';
        document.getElementById('view-pick').replaceWith(goToOfficeButton(() => 'f1'));
        portalBar();
        // The Portal navigation's phone button (ui/portal/nav.ts puts it first in the bar; layout.css hides it on a desktop).
        const navBtn = document.createElement('button');
        navBtn.className = 'pt-iconbtn pt-navbtn pt-only';
        navBtn.textContent = '≡';
        document.querySelector('.lite-bar .pt-launch').before(navBtn);
        let tab = 'board';
        let came;
        window.__opened = [];
        const data = { floor: 'f1', project: 'Visitor Registration', business: { state: 'ready-for-review', label: 'Ready to try', tone: 'busy', line: 'Ready to try', missing: [], notes: [] }, decisions: [], changes: [], milestones: [], others: 0 };
        const ws = createWorkspace({ source: { get: () => data, on: () => () => {}, wake() {}, request: async () => ({ ok: false }), answer: async () => ({ ok: true }) }, open: (t) => window.__open(t) });
        document.querySelector('.lite-main').prepend(ws.el);
        const vs = viewSwitch({ current: () => tab, open: (t) => window.__open(t), cameFrom: () => came });
        placeViewSwitch(vs);
        window.__open = (t) => {
          window.__opened.push(t);
          if (!isAppSection(t)) came = t;
          tab = t;
          if (isAppSection(t)) ws.show();
          else ws.hide();
          vs.draw();
        };`,
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

async function open(page: Page, h: { js: string; css: string }, theme: string) {
  await page.route('**/*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite">${header}${mainPart}</body></html>`);
  await page.addScriptTag({ content: h.js });
}

const go = (page: Page, t: string) => page.evaluate((x) => (window as unknown as { __open(t: string): void }).__open(x), t);
const box = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('header.lite-bar .vs')!.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(window.innerWidth - r.right) };
  });
const pressed = (page: Page) => page.$$eval('.vs-seg', (b) => b.map((x) => `${x.getAttribute('data-view')}:${x.getAttribute('aria-pressed')}`));

test('in a browser: one switch, the same place and size on a Project Management tab and in the Developer view', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    for (const width of [1360, 400]) {
      for (const theme of ['portal-light', 'portal-dark', 'clean-light', 'default']) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors: string[] = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await open(page, h, theme);
        const where = `${theme} at ${width}px`;
        assert.equal(await page.locator('.vs').count(), 1, `${where}: one switch`);
        assert.equal(await page.locator('header.lite-bar .vs').count(), 1, `${where}: in the top bar`);
        // Project Management: the Board.
        await go(page, 'board');
        assert.deepEqual(await pressed(page), ['app:false', 'eng:true'], where);
        const pm = await box(page);
        assert.ok(pm.w > 40 && pm.h >= 28, `${where}: drawn (${JSON.stringify(pm)})`);
        assert.ok(pm.x + pm.w / 2 > width / 2, `${where}: on the right (${JSON.stringify(pm)})`);
        assert.ok(pm.y < 60, `${where}: at the top (${JSON.stringify(pm)})`);
        // Developer: the same box.
        await go(page, 'app');
        assert.equal(await page.evaluate(() => document.body.classList.contains('aw-on')), true);
        assert.deepEqual(await pressed(page), ['app:true', 'eng:false'], where);
        assert.deepEqual(await box(page), pm, `${where}: the same place and size in the Developer view`);
        // Another Project Management tab: the same box again.
        await go(page, 'approvals');
        assert.deepEqual(await box(page), pm, `${where}: the same on Approvals`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${where}: no sideways scrolling`);
        // Phone width: the short words; desktop the full names.
        const shown = await page.$$eval('.vs-seg', (b) => b.map((x) => (x as HTMLElement).innerText.trim()));
        assert.deepEqual(shown, width < 640 ? ['Dev', 'PM'] : ['Developer', 'Project Management'], where);
        assert.deepEqual(await page.$$eval('.vs-seg', (b) => b.map((x) => x.getAttribute('aria-label'))), ['Developer view', 'Project Management view']);
        assert.deepEqual(errors, [], where);
        await page.close();
      }
    }

    // What it opens: the closest section, back to where you came from, the closest page; never a navigation.
    const page = await browser.newPage({ viewport: { width: 1360, height: 800 } });
    await open(page, h, 'portal-light');
    const url = page.url();
    await go(page, 'approvals');
    await page.evaluate(() => ((window as unknown as { __opened: string[] }).__opened = []));
    await page.click('.vs-seg[data-view="app"]');
    await page.click('.vs-seg[data-view="eng"]');
    await page.click('.vs-seg[data-view="eng"]'); // already there: nothing
    await page.click('.vs-seg[data-view="app"]');
    await page.evaluate(() => ((window as unknown as { __opened: string[] }).__opened = []));
    await page.click('.vs-seg[data-view="eng"]');
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened), ['approvals'], 'back to the page you came from');
    await go(page, 'documents');
    await page.evaluate(() => ((window as unknown as { __opened: string[] }).__opened = []));
    await page.click('.vs-seg[data-view="app"]');
    assert.deepEqual(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened), ['app'], 'any page → the Developer view (its one tab)');
    // Keys: ← Developer, → Project Management, focus following.
    await page.focus('.vs-seg[data-view="app"]');
    await page.keyboard.press('ArrowRight');
    assert.deepEqual(await pressed(page), ['app:false', 'eng:true']);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-view')), 'eng');
    await page.keyboard.press('ArrowLeft');
    assert.deepEqual(await pressed(page), ['app:true', 'eng:false']);
    assert.equal(page.url(), url, 'the project stays: the switch never navigates');
    assert.equal(await page.getAttribute('.vs', 'aria-keyshortcuts'), 'ArrowLeft ArrowRight');
    await page.close();
  } finally {
    await browser.close();
  }
});
