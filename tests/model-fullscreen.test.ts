// The Model tab's full screen (client/ui/model/fullscreen.ts): the button and F / Shift+F go in and out,
// Esc leaves, the browser's Fullscreen API is used where there is one and a viewport-covering fallback
// where there isn't (or it's refused), and the drawing is fitted again after each change. On a small
// stand-in for the DOM: the module only touches classes, attributes, listeners and the fullscreen calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

type Listener = (e: FakeEvent) => void;
interface FakeEvent {
  type: string;
  key?: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
}

class FakeEl {
  tagName: string;
  className = '';
  textContent = '';
  title = '';
  isContentEditable = false;
  attrs = new Map<string, string>();
  children: unknown[] = [];
  listeners = new Map<string, Listener[]>();
  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => list().includes(c),
      toggle: (c: string, on?: boolean) => {
        const has = list().includes(c);
        const want = on ?? !has;
        el.className = want ? [...new Set([...list(), c])].join(' ') : list().filter((x) => x !== c).join(' ');
        return want;
      },
    };
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  append(...c: unknown[]) {
    for (const x of c) {
      if (typeof x === 'string') this.textContent += x;
      else this.children.push(x);
    }
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: this, ...init };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    return e;
  }
  click() {
    this.dispatch('click');
  }
  requestFullscreen?: (o?: unknown) => Promise<void>;
}

const doc = Object.assign(new FakeEl('#document'), {
  body: new FakeEl('body'),
  fullscreenElement: null as FakeEl | null,
  fullscreenEnabled: true,
  backdrop: false,
  createElement: (t: string) => new FakeEl(t),
  querySelector: (s: string) => (s === '.backdrop' && doc.backdrop ? {} : null),
  exitFullscreen: async () => {
    doc.fullscreenElement = null;
    doc.dispatch('fullscreenchange');
  },
});
Object.assign(globalThis, { document: doc, Node: FakeEl, HTMLElement: FakeEl, requestAnimationFrame: (f: () => void) => setTimeout(f, 0) });

const { fullScreen } = await import('../src/client/ui/model/fullscreen.js');
const frames = () => new Promise((r) => setTimeout(r, 10));
const key = (el: FakeEl, k: string, more: Partial<FakeEvent> = {}) => el.dispatch('keydown', { key: k, ...more });

/** A model view's container with (or without) the Fullscreen API; `refuse` makes the browser say no. */
function setup(api: boolean, refuse = false) {
  const root = new FakeEl('div');
  root.className = 'mxv';
  doc.fullscreenElement = null;
  doc.fullscreenEnabled = api;
  doc.listeners.clear();
  if (api)
    root.requestFullscreen = async () => {
      if (refuse) throw new Error('not allowed');
      doc.fullscreenElement = root;
      doc.dispatch('fullscreenchange');
    };
  let fits = 0;
  const fs = fullScreen(root as unknown as HTMLElement, () => fits++);
  fs.keys();
  return { root, fs, button: fs.button as unknown as FakeEl, fits: () => fits };
}

test('the button puts the model in the browser’s full screen and takes it out, fitting the drawing each way', async () => {
  const { root, fs, button, fits } = setup(true);
  assert.equal(button.textContent, 'Full screen');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  await frames();
  assert.equal(doc.fullscreenElement, root, 'the container itself is in full screen');
  assert.ok(fs.on && root.classList.contains('mx-full'));
  assert.equal(button.textContent, 'Exit full screen');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok(!doc.body.classList.contains('mx-full-open'), 'the browser covers the screen: no page lock needed');
  const after = fits();
  assert.ok(after >= 1, 'fitted on the way in');
  button.click();
  await frames();
  assert.equal(doc.fullscreenElement, null);
  assert.ok(!fs.on && !root.classList.contains('mx-full'));
  assert.ok(fits() > after, 'and fitted again on the way out');
});

test('leaving the browser’s full screen its own way (its Esc, F11) ends the model’s too', async () => {
  const { root, fs } = setup(true);
  fs.enter();
  await frames();
  assert.equal(doc.fullscreenElement, root);
  doc.fullscreenElement = null;
  doc.dispatch('fullscreenchange');
  await frames();
  assert.ok(!fs.on && !root.classList.contains('mx-full'));
});

test('without the Fullscreen API, or when the browser refuses, it covers the window instead; Esc leaves', async () => {
  for (const [api, refuse] of [[false, false], [true, true]] as const) {
    const { root, fs, button } = setup(api, refuse);
    button.click();
    await frames();
    assert.equal(doc.fullscreenElement, null);
    assert.ok(fs.on && root.classList.contains('mx-full'), `covering the window (api ${api}, refused ${refuse})`);
    assert.ok(doc.body.classList.contains('mx-full-open'), 'the page under it is held still');
    // A window over it closes first.
    doc.backdrop = true;
    key(doc, 'Escape');
    assert.ok(fs.on, 'Esc closes the window over it first');
    doc.backdrop = false;
    key(doc, 'Escape');
    await frames();
    assert.ok(!fs.on && !root.classList.contains('mx-full') && !doc.body.classList.contains('mx-full-open'));
  }
});

test('F or Shift+F with the focus in the view goes in and out; not while typing, not with Ctrl (Ctrl+F is the filter)', async () => {
  const { root, fs } = setup(false);
  key(root, 'f');
  assert.ok(fs.on);
  key(root, 'F', { shiftKey: true });
  assert.ok(!fs.on);
  const input = new FakeEl('input');
  key(root, 'f', { target: input });
  assert.ok(!fs.on, 'typing an f in the filter types it');
  key(root, 'f', { ctrlKey: true });
  assert.ok(!fs.on, 'Ctrl+F is the explorer’s filter');
  // An Esc something in the view used (letting go of a picked element) doesn't also leave.
  fs.enter();
  key(doc, 'Escape', { defaultPrevented: true });
  assert.ok(fs.on);
  fs.exit();
  await frames();
});

test('the Model tab has the button and the keys, leaves full screen when the tab closes, and the CSS covers the window in every theme', () => {
  const root = path.join(import.meta.dirname, '..');
  const read = (p: string) => readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
  const index = read('src/client/ui/model/index.ts');
  assert.match(index, /const full = fullScreen\(root, \(\) => \{\n\s+if \(!full\.on\) fitHeight\(\);\n\s+if \(doc\) canvas\.fit\(\);/);
  assert.match(index, /fullBtn,\n\s+\);\n\s+root\.replaceChildren\(bar, body\);/, 'the button at the bar’s end');
  assert.match(index, /full\.keys\(\);/);
  assert.match(index, /hide\(\) \{\n\s+if \(!visible\) return;\n\s+full\.exit\(\);/);
  const css = read('src/client/ui/model/model.css');
  // Not under any theme: the five themes all get it.
  assert.match(css, /^\.mxv\.mx-full \{ position: fixed; inset: 0; z-index: 1000; width: auto !important; height: auto !important;/m);
  assert.match(css, /^\.mxv:fullscreen \{ width: 100% !important; height: 100% !important; \}/m);
  assert.match(css, /^html:has\(body\.mx-full-open\) \{ overflow: hidden; \}/m);
  // Esc on a picked element lets go of it first.
  assert.match(read('src/client/ui/model/canvas.ts'), /if \(this\.selected\) e\.preventDefault\(\);\n\s+this\.select\(null\);/);
});
