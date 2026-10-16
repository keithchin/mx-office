// "Who is it?" on a first visit (shared/ask-name.ts): the page's loading screen (#ao-boot, z-index near
// the top) covered the name prompt, so a fresh browser profile sat at 40 % for good, waiting for a name
// nobody could see (16 Oct 2026). Now the screen steps aside while the page waits on the person and
// comes back for the rest of the load. In headless Chromium, on each flat page's own HTML (its loading
// screen and its script, with the page's bundle swapped for the prompt): the prompt is what is at its
// centre, its field has the focus, the screen is out of the way (no focus kept in it), Enter sends the
// name, and the load then goes on to the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { findChrome } from '../scripts/perf/pages.mjs';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const PAGES = ['lite.html', 'pixel.html', 'home.html', 'clients.html', 'm.html'];

test('the rules: the prompt steps the loading screen aside and back, and every page has the hook', () => {
  const ask = read('src/client/shared/ask-name.ts');
  assert.match(ask, /bootWait\(true\);\s+const modal = openModal/);
  assert.match(ask, /modal\.close\(\);\s+bootWait\(false\);\s+done\(name\);/);
  assert.match(read('src/client/ui/loading/boot.ts'), /export const bootWait = \(on: boolean\) => api\(\)\?\.wait\?\.\(on\);/);
  assert.match(read('src/client/shared/session.ts'), /import \{ askName \} from '\.\/ask-name';/);
  for (const p of PAGES) assert.match(read(`src/client/${p}`), /wait:function\(on\)\{if\(on\)hide\(\);else if\(!d\.view\)show\(\)\}/, `${p} has wait()`);
});

/** The page's HTML without its bundle (and without the other scripts that would fetch the office). */
function pageHtml(file: string) {
  const html = read(`src/client/${file}`);
  return html.replace(/<script type="module"[^>]*><\/script>/g, '').replace(/<link rel="stylesheet"[^>]*>/g, '');
}

const css = () => ['src/client/styles/themes.css', 'src/client/styles/base.css', 'src/client/lite.css'].map((f) => read(f).replace(/@import[^;]+;/g, '')).join('\n');

/** Waits (up to 8 s, for a loaded machine) for `cond`; the assertions after it say what was wrong. */
const settle = (page: import('playwright-core').Page, cond: string) => page.waitForFunction(cond, undefined, { timeout: 8000 }).catch(() => {});

const chrome = findChrome();
test('in a browser, on every page: the prompt seen, focused, sent with Enter, then the load finishes', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { bootStep, bootDrawn } from '../ui/loading/boot';
        import { askName } from './ask-name';
        bootStep('session');
        window.T = { name: '' };
        askName((name) => { window.T.name = name; bootStep('socket'); bootStep('data'); bootDrawn(); });`,
      resolveDir: path.join(root, 'src/client/shared'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const styles = css();
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    for (const file of PAGES) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/*', (r) => r.fulfill({ status: 404, body: '' }));
      await page.setContent(pageHtml(file).replace('</head>', `<style>${styles}</style></head>`), { waitUntil: 'domcontentloaded' });
      assert.equal(await page.evaluate(() => (window as any).__aoBoot.shown()), true, `${file}: the loading screen up`);
      await page.addScriptTag({ content: out.outputFiles[0].text });
      await settle(page, `document.getElementById('ao-boot').hidden && document.activeElement?.matches('.lite-name input')`);
      const seen = await page.evaluate(() => {
        const input = document.querySelector('.lite-name input') as HTMLInputElement;
        const r = input.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const form = document.querySelector('.lite-name')!.getBoundingClientRect();
        const atForm = document.elementFromPoint(form.left + form.width / 2, form.top + form.height / 2);
        const boot = document.getElementById('ao-boot')!;
        return { top: top === input, inForm: !!atForm?.closest('.lite-name'), focused: document.activeElement === input, bootHidden: boot.hidden, busy: boot.getAttribute('aria-busy'), focusInBoot: boot.contains(document.activeElement), shown: (window as any).__aoBoot.shown(), pct: boot.querySelector('.aob-pct')!.textContent };
      });
      assert.deepEqual(seen, { top: true, inForm: true, focused: true, bootHidden: true, busy: null, focusInBoot: false, shown: false, pct: '40' }, `${file}: the prompt in view, not covered`);
      await page.keyboard.type('Alex');
      await page.keyboard.press('Enter');
      await settle(page, `document.getElementById('ao-boot').hidden && !document.querySelector('.lite-name')`);
      const after = await page.evaluate(() => ({ name: (window as any).T.name, prompt: !!document.querySelector('.lite-name'), shown: (window as any).__aoBoot.shown(), pct: document.querySelector('#ao-boot .aob-pct')!.textContent, hidden: document.getElementById('ao-boot')!.hidden }));
      assert.deepEqual(after, { name: 'Alex', prompt: false, shown: false, pct: '100', hidden: true }, `${file}: sent, and the load finished`);
      assert.deepEqual(errors, [], `${file}: no page errors`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('in a browser: after the name the screen comes back for the rest of the load', { skip: chrome ? false : 'no Chromium here' }, async () => {
  const out = await build({
    stdin: {
      contents: `import { bootStep } from '../ui/loading/boot';
        import { askName } from './ask-name';
        bootStep('session');
        window.T = { name: '' };
        askName((name) => { window.T.name = name; });`,
      resolveDir: path.join(root, 'src/client/shared'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const browser = await chromium.launch({ headless: true, executablePath: chrome! });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.route('**/*', (r) => r.fulfill({ status: 404, body: '' }));
    await page.setContent(pageHtml('m.html').replace('</head>', `<style>${css()}</style></head>`), { waitUntil: 'domcontentloaded' });
    await page.addScriptTag({ content: out.outputFiles[0].text });
    await settle(page, `document.activeElement?.matches('.lite-name input')`);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => !!document.querySelector('.lite-name')), true, 'an empty name is not sent');
    await page.keyboard.type('Sam');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => ({ name: (window as any).T.name, shown: (window as any).__aoBoot.shown(), hidden: document.getElementById('ao-boot')!.hidden, busy: document.getElementById('ao-boot')!.getAttribute('aria-busy') }));
    assert.deepEqual(s, { name: 'Sam', shown: true, hidden: false, busy: 'true' }, 'loading again (the socket and data still to come)');
  } finally {
    await browser.close();
  }
});
