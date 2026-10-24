// The Portal left navigation folded to its icon rail (src/client/ui/portal/nav.ts, nav.css, layout.css) in
// headless Chromium, on the 1D view's own top bar and tab row (lite.html) with the page's own styles:
//   - « beside Home folds it to a 56px rail, » unfolds it, and [ does both (never while typing); remembered
//   - folded: every item an icon with its name as the tooltip and an ARIA label, the badges on the corner,
//     the project card its tile, the page you're on still highlighted (its group, or its bottom item)
//   - a group's icon opens a flyout of its pages: arrows move, Enter opens, Esc closes and gives the focus back
//   - the page beside it reflows: no overlap, no sideways scrolling at 1024 and 1360 px, folded or not
//   - on a phone it stays the drawer, whatever was remembered; the classic themes never show it
// The Developer view explorer's rail is tests/app-explorer-dom.test.ts; the real page, scripts/nav-rail-shots.mjs.
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
        import './layout.css';
        import { portalBar } from './topbar';
        import { portalNav } from './nav';
        portalBar();
        // A badge on Approvals (the tab row's, as lite.ts draws it) and a dot on the Overview.
        document.querySelector('#tab-approvals .ro-tab-n').textContent = '3';
        const ny = document.querySelector('#tab-command .ro-tab-n');
        ny.classList.add('dot');
        ny.textContent = '•';
        window.__shown = [];
        window.__ran = [];
        const nav = portalNav({ show: (t) => (window.__shown.push(t), nav.selected(t)), run: (a) => window.__ran.push(a) });
        nav.selected('approvals');
        // Something wide in the page: it must fit beside the pane, never push the page sideways.
        const wide = document.createElement('div');
        wide.id = 'wide';
        wide.style.cssText = 'width:100%;height:40px;background:#8884';
        document.querySelector('.lite-main').prepend(wide);
        const box = document.createElement('input');
        box.id = 'typing';
        document.querySelector('.lite-main').prepend(box);`,
      resolveDir: path.join(root, 'src/client/ui/portal'),
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

async function open(page: Page, h: { js: string; css: string }, theme: string, stored?: string) {
  // A real origin (not about:blank), so the page has its storage as in the office.
  const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${h.css}</style></head><body class="lite">${header}${mainPart}</body></html>`;
  await page.route('**/*', (r) => (r.request().url() === 'http://office.test/' ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.fulfill({ status: 404, body: '' })));
  await page.goto('http://office.test/');
  if (stored !== undefined) await page.evaluate((s) => localStorage.setItem('agent-office.portal-nav', s), stored);
  await page.addScriptTag({ content: h.js });
}

const railed = (page: Page) => page.evaluate(() => document.body.classList.contains('pt-rail'));
const navW = (page: Page) => page.evaluate(() => Math.round(document.getElementById('pt-nav')!.getBoundingClientRect().width));
const settle = (page: Page) => page.waitForTimeout(700);
const fits = (page: Page) =>
  page.evaluate(() => {
    const nav = document.getElementById('pt-nav')!.getBoundingClientRect();
    const main = document.querySelector('.lite-main')!.getBoundingClientRect();
    const wide = document.getElementById('wide')!.getBoundingClientRect();
    return { overlap: main.left < nav.right - 0.5, sideways: document.documentElement.scrollWidth > innerWidth, wideOut: wide.right > innerWidth + 0.5 };
  });

test('in a browser: the Portal navigation folds to an icon rail and back, remembered, the page reflowing', { skip: chrome ? false : 'no Chromium here', timeout: 120_000 }, async () => {
  const h = await harness();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    for (const theme of ['portal-light', 'portal-dark']) {
      const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await open(page, h, theme);
      const at = theme;
      // Open: as it always was, the fold control beside Home.
      assert.equal(await railed(page), false, `${at}: open at first`);
      assert.ok((await navW(page)) > 200, `${at}: the full pane`);
      assert.equal(await page.locator('.pt-nav-top .pt-home-item + .pt-nav-fold').count(), 1, `${at}: « beside Home`);
      assert.equal(await page.getAttribute('.pt-nav-fold', 'aria-expanded'), 'true');
      assert.equal(await page.getAttribute('.pt-nav-fold', 'aria-label'), 'Collapse the navigation');
      assert.equal((await page.textContent('.pt-nav-fold:visible'))?.includes('«') || (await page.locator('.pt-fold-l').isVisible()), true);
      assert.equal(await page.locator('[data-nav="approvals"].on[aria-current="page"]').count(), 1, `${at}: the page picked`);
      assert.deepEqual(await fits(page), { overlap: false, sideways: false, wideOut: false }, `${at}: open, the page fits beside it`);

      // Fold: a 56px rail, the page moves over.
      await page.click('.pt-nav-fold');
      await settle(page);
      assert.equal(await railed(page), true, `${at}: folded`);
      assert.equal(await navW(page), 56, `${at}: a 56px rail`);
      assert.equal(await page.getAttribute('.pt-nav-fold', 'aria-expanded'), 'false');
      assert.equal(await page.getAttribute('.pt-nav-fold', 'aria-label'), 'Expand the navigation');
      assert.equal(await page.locator('.pt-fold-r').isVisible(), true, `${at}: » shows`);
      assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('pt-nav-fold')), true, `${at}: the focus stays on the control`);
      assert.deepEqual(await fits(page), { overlap: false, sideways: false, wideOut: false }, `${at}: folded, the page fits`);
      assert.ok(await page.evaluate(() => document.querySelector('.lite-main')!.getBoundingClientRect().left < 120), `${at}: the page took the room`);
      assert.equal(JSON.parse((await page.evaluate(() => localStorage.getItem('agent-office.portal-nav'))) ?? '{}').rail, true, `${at}: remembered`);

      // Every item an icon, its name the tooltip and the label, the words hidden.
      const heads = await page.$$eval('.pt-group-h', (els) =>
        els.map((e) => ({ id: (e as HTMLElement).dataset.group, title: e.getAttribute('title'), label: e.getAttribute('aria-label'), popup: e.getAttribute('aria-haspopup'), ico: !!e.querySelector('.pt-group-ico') && getComputedStyle(e.querySelector('.pt-group-ico')!).display !== 'none', words: getComputedStyle(e.querySelector('.pt-group-l')!).display, w: Math.round(e.getBoundingClientRect().width) })),
      );
      assert.deepEqual(heads.map((x) => x.title), ['General', 'Project Management', 'App Insights', 'Repository', 'Deployment', 'Monitoring'], `${at}: the groups' tooltips`);
      for (const x of heads) {
        assert.ok(x.ico && x.words === 'none' && x.popup === 'menu' && x.label?.startsWith(x.title!), `${at}: ${x.id} an icon with its label: ${JSON.stringify(x)}`);
        assert.ok(x.w <= 56, `${at}: ${x.id} inside the rail`);
      }
      assert.equal(heads.find((x) => x.id === 'pm')!.label, 'Project Management, 3', `${at}: the badge in the label`);
      // The group icons are all different (General isn't Home's house).
      const glyphs = await page.$$eval('.pt-nav .pt-group-ico, .pt-nav .pt-item-ico', (els) => els.filter((e) => getComputedStyle(e).display !== 'none' && (e as SVGElement).getBoundingClientRect().width > 0).map((e) => e.innerHTML));
      assert.equal(new Set(glyphs).size, glyphs.length, `${at}: no icon twice in the rail`);
      const bottom = await page.$$eval('.pt-bottom li:not([hidden]) .pt-item', (els) => els.map((e) => ({ title: e.getAttribute('title'), label: e.getAttribute('aria-label'), ico: !!e.querySelector('.pt-item-ico') })));
      assert.ok(bottom.length >= 2, `${at}: Settings and View App`);
      for (const b of bottom) assert.ok(b.ico && b.title && b.label?.startsWith(b.title.split(':')[0]), `${at}: a bottom item with its icon and words: ${JSON.stringify(b)}`);
      assert.equal(await page.getAttribute('.pt-home-item', 'aria-label'), 'Home');
      assert.equal(await page.locator('.pt-proj-tile').isVisible(), true, `${at}: the project's tile`);
      assert.match((await page.getAttribute('.pt-proj', 'title')) ?? '', /project/i);

      // The badges on the corner, inside the rail, not clipped.
      const badge = await page.$eval('.pt-group-h[data-group="pm"] .pt-nbadge', (e) => {
        const r = e.getBoundingClientRect();
        const nav = document.getElementById('pt-nav')!.getBoundingClientRect();
        return { shown: !(e as HTMLElement).hidden && r.width > 0, text: e.textContent, inside: r.left >= nav.left && r.right <= nav.right - 1 };
      });
      assert.deepEqual(badge, { shown: true, text: '3', inside: true }, `${at}: Project Management's 3 on its icon`);
      assert.equal(await page.$eval('.pt-group-h[data-group="general"] .pt-nbadge', (e) => !(e as HTMLElement).hidden && e.classList.contains('dot')), true, `${at}: General's dot`);

      // The page you're on: its group highlighted.
      assert.equal(await page.locator('.pt-group.has-current > .pt-group-h[data-group="pm"]').count(), 1);
      const bg = (sel: string) => page.$eval(sel, (e) => getComputedStyle(e).backgroundColor);
      assert.notEqual(await bg('.pt-group-h[data-group="pm"]'), await bg('.pt-group-h[data-group="repo"]'), `${at}: the page's group stands out`);

      // A group's flyout, by keyboard: Enter opens it with the focus on its first page, arrows move, Esc closes and gives the focus back.
      await page.focus('.pt-group-h[data-group="insights"]');
      await page.keyboard.press('Enter');
      assert.equal(await page.isVisible('.pt-flyout'), true, `${at}: the flyout`);
      assert.equal(await page.getAttribute('.pt-group-h[data-group="insights"]', 'aria-expanded'), 'true');
      assert.equal(await page.textContent('.pt-fly-h'), 'App Insights');
      const first = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.nav);
      assert.equal(first, 'analysis', `${at}: the focus on its first page`);
      await page.keyboard.press('ArrowDown');
      const second = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.nav);
      assert.notEqual(second, first, `${at}: ↓ moves`);
      const flyBox = await page.$eval('.pt-flyout', (e) => ({ left: e.getBoundingClientRect().left, right: e.getBoundingClientRect().right }));
      assert.ok(flyBox.left >= 56 && flyBox.right <= 1360, `${at}: beside the rail, in the window`);
      await page.keyboard.press('Escape');
      assert.equal(await page.isHidden('.pt-flyout'), true, `${at}: Esc closes it`);
      assert.equal(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.group), 'insights', `${at}: the focus back on the group`);
      assert.equal(await page.getAttribute('.pt-group-h[data-group="insights"]', 'aria-expanded'), 'false');
      // A click opens it too, and a page picked in it is shown (and highlighted in the flyout next time).
      await page.click('.pt-group-h[data-group="repo"]');
      await page.click('.pt-fly-item[data-nav="model"]');
      assert.deepEqual(await page.evaluate(() => (window as unknown as { __shown: string[] }).__shown), ['model']);
      assert.equal(await page.isHidden('.pt-flyout'), true);
      assert.equal(await page.locator('.pt-group.has-current > .pt-group-h[data-group="repo"]').count(), 1, `${at}: Model's group highlighted now`);
      await page.click('.pt-group-h[data-group="repo"]');
      assert.equal(await page.locator('.pt-fly-item.on[data-nav="model"]').count(), 1, `${at}: and Model in its flyout`);
      await page.keyboard.press('Escape');
      // The bottom items work as icons.
      await page.click('.pt-bottom [data-nav="settings"]');
      assert.equal(await page.locator('.pt-bottom .pt-item.on[data-nav="settings"]').count(), 1, `${at}: Settings highlighted in the rail`);

      // At 1024 px too: no sideways scrolling, folded or not.
      await page.setViewportSize({ width: 1024, height: 768 });
      await settle(page);
      assert.deepEqual(await fits(page), { overlap: false, sideways: false, wideOut: false }, `${at}: folded at 1024`);

      // [ unfolds it, but not while typing in a box (nor with Ctrl: the terminal's Esc).
      await page.focus('#typing');
      await page.keyboard.press('[');
      assert.equal(await railed(page), true, `${at}: [ typed in a box stays text`);
      assert.equal(await page.inputValue('#typing'), '[');
      await page.evaluate(() => (document.activeElement as HTMLElement).blur());
      await page.keyboard.press('Control+[');
      assert.equal(await railed(page), true, `${at}: Ctrl+[ isn't it`);
      await page.keyboard.press('[');
      await settle(page);
      assert.equal(await railed(page), false, `${at}: [ unfolds it`);
      assert.deepEqual(await fits(page), { overlap: false, sideways: false, wideOut: false }, `${at}: open at 1024`);
      assert.equal(JSON.parse((await page.evaluate(() => localStorage.getItem('agent-office.portal-nav'))) ?? '{}').rail, false);
      assert.equal(await page.locator('.pt-bottom .pt-item.on[data-nav="settings"]').count(), 1, `${at}: the page still picked open`);
      assert.equal(await page.getAttribute('.pt-group-h[data-group="pm"]', 'aria-label'), null, `${at}: open, the words are the name again`);
      await page.keyboard.press('[');
      await settle(page);
      assert.equal(await railed(page), true, `${at}: [ folds it`);
      assert.deepEqual(errors, [], at);
      await page.close();
    }

    // Remembered: a new visit comes back folded, before anything is clicked.
    const again = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    await open(again, h, 'portal-light', JSON.stringify({ open: {}, rail: true }));
    assert.equal(await railed(again), true, 'a new visit comes back folded');
    assert.equal(await navW(again), 56);
    // Storage that throws (a private window): it still works, just for this visit.
    await again.close();
    const blocked = await browser.newPage({ viewport: { width: 1360, height: 860 } });
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    const errs: string[] = [];
    blocked.on('pageerror', (e) => errs.push(e.message));
    await open(blocked, h, 'portal-light');
    await blocked.click('.pt-nav-fold');
    assert.equal(await railed(blocked), true, 'folds with storage blocked');
    assert.deepEqual(errs, [], 'no errors with storage blocked');
    await blocked.close();

    // A phone: the drawer, whatever was remembered; no fold control, no [.
    const phone = await browser.newPage({ viewport: { width: 400, height: 860 } });
    await open(phone, h, 'portal-light', JSON.stringify({ open: {}, rail: true }));
    assert.equal(await phone.isVisible('.pt-nav-fold'), false, 'no « on a phone');
    assert.equal(await phone.isVisible('.pt-navbtn'), true, 'the ☰');
    await phone.keyboard.press('[');
    await phone.click('.pt-navbtn');
    await phone.waitForTimeout(300);
    const drawer = await phone.evaluate(() => ({ w: Math.round(document.getElementById('pt-nav')!.getBoundingClientRect().width), left: Math.round(document.getElementById('pt-nav')!.getBoundingClientRect().left), words: getComputedStyle(document.querySelector('.pt-group-l')!).display }));
    assert.ok(drawer.w > 250 && drawer.left === 0 && drawer.words !== 'none', `the whole drawer, words and all: ${JSON.stringify(drawer)}`);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scrolling on a phone');
    await phone.close();

    // The classic themes: no pane at all (their tab row as it was).
    for (const theme of ['clean-light', 'default']) {
      const p = await browser.newPage({ viewport: { width: 1360, height: 860 } });
      await open(p, h, theme);
      assert.equal(await p.isVisible('#pt-nav'), false, `${theme}: no Portal pane`);
      assert.equal(await p.isVisible('.lite-tabs'), true, `${theme}: the tab row`);
      await p.keyboard.press('[');
      assert.equal(await p.isVisible('#pt-nav'), false, `${theme}: [ does nothing visible`);
      await p.close();
    }
  } finally {
    await browser.close();
  }
});
