// The 🎨's list of themes (ui/colortheme.ts, ui/flatchrome.css) is a popover under the button, never part
// of the top bar's flow. Its rules (position, hidden, the card) lived with the old view dropdown and went
// with the 3D removal (351a0aa): from then on the list opened inline, inside the bar, stretching the
// Portal bar from 44 px to 235 px. scripts/check-theme-menu.mjs checks it in a browser on every page.
// Here: the stylesheet keeps it an overlay, and on a stand-in DOM (tests/support/fakedom.ts) it starts
// closed, opens under the button, and closes on Esc, a pick, a click elsewhere or the button again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { installFakeDom, fakeDocument, FakeEl } from './support/fakedom.js';

const root = path.join(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function sheets(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(path.join(root, dir))) {
    const p = path.join(dir, e);
    if (statSync(path.join(root, p)).isDirectory()) out.push(...sheets(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out;
}

/** Every rule in `css` as selector and body (media queries flattened). */
function rules(css: string): { sel: string; body: string }[] {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m; (m = re.exec(plain)); ) out.push({ sel: m[1].trim().replace(/^@[^{]*$/, ''), body: m[2].trim() });
  return out;
}

test('the theme list is an overlay in the stylesheet: fixed, above the page, hidden when closed', () => {
  const css = rules(read('src/client/ui/flatchrome.css'));
  const base = css.find((r) => r.sel === '.vp-list');
  assert.ok(base, 'flatchrome.css has a .vp-list rule');
  assert.match(base.body, /position:\s*fixed/);
  assert.match(base.body, /z-index:\s*\d{3,}/);
  const hidden = css.find((r) => r.sel === '.vp-list[hidden]');
  assert.ok(hidden && /display:\s*none/.test(hidden.body), '.vp-list[hidden] is display: none');
  // No theme puts it back into the flow.
  for (const f of sheets('src/client')) {
    for (const r of rules(read(f))) {
      if (!/\.(vp-list|theme-list)\b/.test(r.sel)) continue;
      const pos = r.body.match(/(?:^|;)\s*position:\s*([a-z]+)/);
      assert.ok(!pos || pos[1] === 'fixed', `${f}: ${r.sel} sets position: ${pos?.[1]}`);
      if (!r.sel.includes('[hidden]')) assert.doesNotMatch(r.body, /(?:^|;)\s*display:/,`${f}: ${r.sel} sets display (would show a closed list)`);
    }
  }
});

// ---- On the stand-in DOM ---------------------------------------------------------------------------

installFakeDom();
type Rect = { top: number; right: number; bottom: number; left: number; width: number; height: number };
const rects = new WeakMap<FakeEl, Rect>();
const styles = new WeakMap<FakeEl, Record<string, string>>();
const proto = FakeEl.prototype as unknown as Record<string, unknown>;
Object.defineProperties(proto, {
  style: { get(this: FakeEl) { if (!styles.has(this)) styles.set(this, {}); return styles.get(this); } },
  dataset: { get(this: FakeEl) { const el = this; return new Proxy({}, { get: (_, k) => el.getAttribute(`data-${String(k)}`) ?? undefined, set: (_, k, v) => (el.setAttribute(`data-${String(k)}`, String(v)), true) }); } },
  offsetWidth: { get(this: FakeEl) { return rects.get(this)?.width ?? 0; } },
  clientWidth: { get() { return 390; } },
});
proto.getBoundingClientRect = function (this: FakeEl): Rect {
  const r = rects.get(this);
  if (r) return r;
  // The list: where its style put it (position: fixed, so the window's frame).
  const s = styles.get(this) ?? {};
  const left = parseFloat(s.left ?? '0');
  const top = parseFloat(s.top ?? '0');
  return { left, top, right: left + 250, bottom: top + 300, width: 250, height: 300 };
};
const winListeners = new Map<string, Set<(e: unknown) => void>>();
const docListeners = new Map<string, Set<(e: unknown) => void>>();
const on = (m: typeof winListeners) => (t: string, fn: (e: unknown) => void) => void (m.get(t) ?? m.set(t, new Set()).get(t)!).add(fn);
const off = (m: typeof winListeners) => (t: string, fn: (e: unknown) => void) => void m.get(t)?.delete(fn);
Object.assign(globalThis, { addEventListener: on(winListeners), removeEventListener: off(winListeners), innerWidth: 390, matchMedia: () => ({ matches: false }) });
Object.assign(fakeDocument, { addEventListener: on(docListeners), removeEventListener: off(docListeners) });

function fire(el: FakeEl, type: string, extra: Record<string, unknown> = {}) {
  let stopped = false;
  const e = { type, target: el, currentTarget: el, key: '', preventDefault() {}, stopPropagation: () => (stopped = true), ...extra };
  for (const fn of el.listeners.get(type) ?? []) fn(e as never);
  return stopped;
}

test('the 🎨 list starts closed, opens under the button as an overlay, and closes on Esc, a pick, outside or the button', async () => {
  localStorage.setItem('agent-office.color-theme', 'default');
  const toasts = new FakeEl('div');
  toasts.id = 'toasts';
  const bar = new FakeEl('header');
  bar.className = 'lite-bar';
  const button = new FakeEl('button');
  bar.append(button);
  const elsewhere = new FakeEl('main');
  fakeDocument.body.append(toasts, bar, elsewhere);
  // The 🎨 near the bar's right end on a phone (390 px wide): 32 px square.
  rects.set(button, { left: 340, right: 372, top: 6, bottom: 38, width: 32, height: 32 });

  const { colorThemes, currentTheme } = await import('../src/client/ui/colortheme.js');
  colorThemes(button as unknown as HTMLElement);
  const list = fakeDocument.getElementById('theme-list') as FakeEl;
  assert.ok(list, 'the list is made');
  assert.equal(list.hidden, true, 'closed by default');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(button.getAttribute('aria-haspopup'), 'listbox');
  // The list is 250 px wide.
  Object.defineProperty(list, 'offsetWidth', { get: () => 250 });

  button.click();
  assert.equal(list.hidden, false, 'the button opens it');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  const s = (list as unknown as { style: Record<string, string> }).style;
  assert.equal(s.top, '46px', '8 px under the button');
  assert.equal(s.left, '122px', 'its right edge on the button’s (372 − 250)');
  assert.ok((docListeners.get('pointerdown')?.size ?? 0) > 0, 'listens for a click elsewhere while open');

  fire(list, 'keydown', { key: 'Escape' });
  assert.equal(list.hidden, true, 'Esc closes it');
  assert.equal(fakeDocument.activeElement, button, 'focus goes back to the 🎨');
  assert.equal(docListeners.get('pointerdown')?.size ?? 0, 0, 'stops listening once closed');

  button.click();
  for (const fn of docListeners.get('pointerdown') ?? []) fn({ target: elsewhere });
  assert.equal(list.hidden, true, 'a click elsewhere closes it');

  button.click();
  button.click();
  assert.equal(list.hidden, true, 'the button again closes it');

  // Kept inside the window when the button is near the left edge.
  rects.set(button, { left: 4, right: 36, top: 6, bottom: 38, width: 32, height: 32 });
  button.click();
  assert.equal(s.left, '8px', 'never off the window’s left edge');
  const fun = list.querySelectorAll('.vp-opt')[5];
  fire(list, 'click', { target: { closest: () => fun } });
  assert.equal(list.hidden, true, 'a pick closes it');
  assert.equal(currentTheme(), 'dark', 'and puts the theme on');
});
