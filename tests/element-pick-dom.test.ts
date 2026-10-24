// Select element on the Model preview (client/ui/model/page-frame.ts with `pick`, preview-pick.ts) in headless
// Chromium (new headless): the frame is painted with its script; the project's layout classes put tiles side by
// side; hovering outlines a widget with its label; a click selects it; a message from anywhere but the frame is
// ignored; Esc leaves picking and gives the focus back; Tab and Enter pick by keyboard; the selection survives
// a redraw when its name is still there and says it's gone when not; a big nested page stays short and quick;
// and at a phone's width nothing scrolls sideways.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Frame, type Page } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const chrome = findChrome();

const PAGE = (extra = '', save = "actionbutton btnSave (Caption: 'Save', ButtonStyle: Primary)") => `create or modify page Desk.Visit_Overview (Title: 'Today’s visitors', Layout: Atlas_Core.Atlas_Default) {
  container ctnCounters (Class: 'counters') {
    container ctnExpected (Class: 'counter') { dynamictext txtExpectedN (Content: '12') dynamictext txtExpectedL (Content: 'Expected') }
    container ctnArrived (Class: 'counter') { dynamictext txtArrivedN (Content: '7') dynamictext txtArrivedL (Content: 'Arrived') }
    container ctnLeft (Class: 'counter') { dynamictext txtLeftN (Content: '3') dynamictext txtLeftL (Content: 'Left') }
  }
  dataview dvVisit (DataSource: $Visit) {
    textbox tbName (Label: 'Visitor name', Attribute: VisitorName)
    ${save}
    actionbutton btnCancel (Caption: 'Cancel')
  }
  ${extra}
}`;
const LAY = `create or modify layout Atlas_Core.Atlas_Default { container ctnTop (Class: 'top') { dynamictext brand (Content: 'Visitor desk') } placeholder Main }`;
const THEME = '.counters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.counter{display:flex;flex-direction:column;padding:16px;border:1px solid #e2e4e8;background:#fff}';

function nested(depth: number, per: number): string {
  let body = `dynamictext txtLeaf (Content: 'Leaf')`;
  for (let d = depth; d >= 1; d--) body = `listview lv${d} (DataSource: microflow Desk.DS_${d}) {\n${Array.from({ length: per }, (_, i) => `dynamictext t${d}_${i} (Content: 'Row text ${i}')`).join('\n')}\n${body}\n}`;
  return `create or modify page Desk.Visit_Edit (Title: 'Visit') {\n${body}\n}`;
}

async function harness() {
  const res = await build({
    stdin: {
      contents: `
        import '../model/page.css';
        import { pageFrame } from '../model/page-frame';
        const LAY = ${JSON.stringify(LAY)};
        const THEME = ${JSON.stringify(THEME)};
        window.changes = [];
        const box = document.createElement('div');
        box.style.cssText = 'position:relative;width:900px;height:700px';
        document.body.append(box);
        const f = pageFrame(async (t) => (t === 'layout' ? LAY : null), {
          change: (s) => window.changes.push(s ? { name: s.name, gone: !!s.gone, label: s.label, doc: s.docQn } : null),
          theme: async () => THEME,
        });
        box.append(f.el);
        window.f = f;`,
      resolveDir: path.join(root, 'src/client/ui/app-workspace'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    outdir: 'out',
    format: 'iife',
    loader: { '.css': 'css' },
    logLevel: 'silent',
    minify: true,
  });
  return { js: res.outputFiles.find((f) => f.path.endsWith('.js'))!.text, css: res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '' };
}

/** The preview frame on screen (a fresh frame per document: the newest attached one). */
async function preview(page: Page): Promise<Frame> {
  for (let i = 0; i < 50; i++) {
    const handle = await page.$('.pgp-frame');
    const fr = handle ? await handle.contentFrame() : null;
    if (fr && (await fr.$('[data-mx-el]').catch(() => null))) return fr;
    await page.waitForTimeout(50);
  }
  throw new Error('no preview frame');
}
const changes = (page: Page) => page.evaluate(() => (window as unknown as { changes: ({ name: string; gone: boolean; label: string } | null)[] }).changes);

test('Select element in a real Chromium: painted, side by side, hover, click, checked messages, keyboard, redraw, height, phone', { skip: chrome ? false : 'no Chromium here', timeout: 90_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome!, args: ['--headless=new'] });
  try {
    const page = await browser.newPage({ viewport: { width: 940, height: 760 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(`<!doctype html><html><head><style>${h.css}</style></head><body></body></html>`);
    await page.addScriptTag({ content: h.js });
    await page.evaluate((m) => (window as unknown as { f: { show(m: string): boolean } }).f.show(m), PAGE());
    await page.waitForTimeout(500);
    let fr = await preview(page);

    // Painted (the script doesn't blank it), and the project's layout classes put the tiles side by side.
    assert.ok(((await fr.evaluate(() => document.body.innerText)) ?? '').includes('Visitor name'), 'the page is drawn');
    const tops = await fr.$$eval('.counter', (els) => els.map((e) => [Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().left)]));
    assert.equal(tops.length, 3);
    assert.ok(tops.every(([t]) => t === tops[0][0]) && tops[1][1] > tops[0][1] && tops[2][1] > tops[1][1], `tiles side by side: ${JSON.stringify(tops)}`);
    assert.equal(await fr.evaluate(() => getComputedStyle(document.querySelector('.counters')!).display), 'grid');

    // Hover: an outline and the widget's label; click: selected.
    await page.click('.pgp-pick');
    assert.equal(await page.getAttribute('.pgp-pick', 'aria-pressed'), 'true');
    await page.waitForTimeout(100);
    await fr.hover('[data-mx-w="btnSave"]');
    await fr.waitForSelector('[data-mx-w="btnSave"].mx-hover');
    assert.equal(await fr.textContent('.mx-pick-label:not(.sel)'), 'Save button');
    await fr.click('[data-mx-w="btnSave"]');
    await page.waitForFunction(() => (window as unknown as { changes: unknown[] }).changes.length === 1);
    assert.deepEqual((await changes(page))[0], { name: 'btnSave', gone: false, label: 'Save button', doc: 'Desk.Visit_Overview' } as never);
    await fr.waitForSelector('[data-mx-w="btnSave"].mx-sel');

    // A message from the page itself (not the frame), or a forged shape: ignored.
    await page.evaluate(() => {
      window.postMessage({ mx: 'pick', type: 'select', el: 0, w: 'ctnCounters' }, '*');
      window.postMessage({ mx: 'pick', type: 'select', el: 1 }, '*');
    });
    await page.waitForTimeout(150);
    assert.equal((await changes(page)).length, 1, 'nothing selected by a message from elsewhere');

    // Esc leaves picking and gives the focus back to the button.
    await fr.press('[data-mx-w="btnSave"]', 'Escape');
    await page.waitForFunction(() => document.querySelector('.pgp-pick')?.getAttribute('aria-pressed') === 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pgp-pick')), true);
    // Keyboard: on again (the selected widget gets the focus), Tab to the next widget, Enter selects it.
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.pgp-pick')?.getAttribute('aria-pressed') === 'true');
    await page.waitForTimeout(150);
    assert.equal(await fr.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.mxW), 'btnSave', 'the selected widget has the focus');
    await page.keyboard.press('Tab');
    assert.equal(await fr.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.mxW), 'btnCancel', 'Tab moves to the next widget');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as unknown as { changes: unknown[] }).changes.length === 2);
    assert.equal((await changes(page))[1]?.name, 'btnCancel');
    // Each widget is a stop once, with its label for screen readers.
    assert.equal(await fr.getAttribute('[data-mx-w="btnCancel"]', 'aria-label'), 'Cancel button');

    // A redraw where the name is still there: still selected (and outlined); where it's gone: said so.
    await page.evaluate((m) => (window as unknown as { f: { show(m: string): boolean } }).f.show(m), PAGE("dynamictext txtNew (Content: 'New line')"));
    await page.waitForTimeout(300);
    fr = await preview(page);
    assert.equal(await page.evaluate(() => (window as unknown as { f: { selected: { name: string; gone?: boolean } } }).f.selected.gone ?? false), false);
    await fr.waitForSelector('[data-mx-w="btnCancel"].mx-sel');
    await page.evaluate((m) => (window as unknown as { f: { show(m: string): boolean } }).f.show(m), PAGE('', '').replace("actionbutton btnCancel (Caption: 'Cancel')", ''));
    await page.waitForFunction(() => (window as unknown as { changes: { gone: boolean }[] }).changes.at(-1)?.gone === true);
    assert.equal((await changes(page)).at(-1)?.name, 'btnCancel');

    // A big nested page: short and quick (the 91,000 px case).
    await page.evaluate((m) => (window as unknown as { f: { show(m: string): boolean } }).f.show(m), nested(6, 12));
    await page.waitForTimeout(300);
    fr = await preview(page);
    const height = await fr.evaluate(() => document.documentElement.scrollHeight);
    const ms = await page.evaluate(() => (window as unknown as { f: { lastMs: number } }).f.lastMs);
    assert.ok(height < 20_000, `height capped: ${height}px`);
    assert.ok(ms < 500, `drawn in ${ms.toFixed(0)} ms`);
    assert.ok(((await fr.evaluate(() => document.body.innerText)) ?? '').includes('more rows (sample)'));

    // Phone width: nothing scrolls sideways inside the frame.
    await page.evaluate((m) => (window as unknown as { f: { show(m: string): boolean } }).f.show(m), PAGE());
    await page.click('.pgp-bar button:has-text("Phone")');
    await page.waitForTimeout(300);
    fr = await preview(page);
    const w = await fr.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert.ok(w[1] <= 392 && w[0] <= w[1] + 1, `no sideways scroll at the phone's width: ${w}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
