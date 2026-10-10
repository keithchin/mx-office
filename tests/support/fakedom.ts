// A small stand-in for the DOM, for client modules that only build elements, move them about and read
// them back (ui/summary.ts, ui/setup-panel.ts): nodes and text, attributes and classes, children moved
// and replaced the way the DOM does it, outerHTML, simple selectors (tag, .class, #id, [attr], and a
// space between them), listeners, focus, value and scrollTop. No layout, no styles.
// installFakeDom() puts it on globalThis (document, Node, HTMLElement, Element, Text, localStorage).

export class FakeNode {
  parentNode: FakeEl | null = null;
  get parentElement(): FakeEl | null {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get nodeType(): number {
    return 3;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null;
  }
  get previousSibling(): FakeNode | null {
    const p = this.parentNode;
    if (!p) return null;
    return p.childNodes[p.childNodes.indexOf(this) - 1] ?? null;
  }
  get isConnected(): boolean {
    let n: FakeNode | null = this;
    while (n.parentNode) n = n.parentNode;
    return n === fakeDocument.documentElement || n === (fakeDocument as unknown as FakeNode);
  }
  remove() {
    this.parentNode?.removeChild(this);
  }
  before(...nodes: (FakeNode | string)[]) {
    const p = this.parentNode;
    if (!p) return;
    for (const n of nodes) p.insertBefore(toNode(n), this);
  }
  after(...nodes: (FakeNode | string)[]) {
    const p = this.parentNode;
    if (!p) return;
    const ref = this.nextSibling;
    for (const n of nodes) p.insertBefore(toNode(n), ref);
  }
  get textContent(): string {
    return '';
  }
  set textContent(_v: string) {}
  get outerHTML(): string {
    return '';
  }
}

export class FakeText extends FakeNode {
  constructor(public data: string) {
    super();
  }
  override get textContent() {
    return this.data;
  }
  override set textContent(v: string) {
    this.data = v;
  }
  override get outerHTML() {
    return this.data.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  }
}

const toNode = (n: FakeNode | string | number) => (n instanceof FakeNode ? n : new FakeText(String(n)));

type Listener = (e: { type: string; currentTarget: FakeEl; target: FakeEl; preventDefault(): void }) => void;

/** Every element made, for counting what a render built. */
export const made = { elements: 0 };

export class FakeEl extends FakeNode {
  readonly tagName: string;
  childNodes: FakeNode[] = [];
  attrs = new Map<string, string>();
  listeners = new Map<string, Set<Listener>>();
  value = '';
  scrollTop = 0;
  disabled = false;
  constructor(tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    made.elements++;
  }
  override get nodeType() {
    return 1;
  }
  get children(): FakeEl[] {
    return this.childNodes.filter((c): c is FakeEl => c instanceof FakeEl);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get className() {
    return this.attrs.get('class') ?? '';
  }
  set className(v: string) {
    this.attrs.set('class', v);
  }
  get id() {
    return this.attrs.get('id') ?? '';
  }
  set id(v: string) {
    this.attrs.set('id', v);
  }
  get title() {
    return this.attrs.get('title') ?? '';
  }
  set title(v: string) {
    this.attrs.set('title', v);
  }
  get hidden() {
    return this.attrs.has('hidden');
  }
  set hidden(v: boolean) {
    if (v) this.attrs.set('hidden', '');
    else this.attrs.delete('hidden');
  }
  get classList() {
    const list = () => this.className.split(/\s+/).filter(Boolean);
    const set = (l: string[]) => (this.className = [...new Set(l)].join(' '));
    return {
      contains: (c: string) => list().includes(c),
      add: (...c: string[]) => set([...list(), ...c]),
      remove: (...c: string[]) => set(list().filter((x) => !c.includes(x))),
      toggle: (c: string, on?: boolean) => {
        const want = on ?? !list().includes(c);
        set(want ? [...list(), c] : list().filter((x) => x !== c));
        return want;
      },
    };
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  insertBefore(n: FakeNode, ref: FakeNode | null) {
    if (n === ref) return n;
    n.parentNode?.removeChild(n);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(n);
    else this.childNodes.splice(at, 0, n);
    n.parentNode = this;
    return n;
  }
  appendChild(n: FakeNode) {
    return this.insertBefore(n, null);
  }
  removeChild(n: FakeNode) {
    const at = this.childNodes.indexOf(n);
    if (at >= 0) this.childNodes.splice(at, 1);
    n.parentNode = null;
    if (fakeDocument.activeElement && !fakeDocument.activeElement.isConnected) fakeDocument.activeElement = null;
    return n;
  }
  append(...nodes: (FakeNode | string | number)[]) {
    for (const n of nodes) this.appendChild(toNode(n));
  }
  prepend(...nodes: (FakeNode | string | number)[]) {
    const ref = this.firstChild;
    for (const n of nodes) this.insertBefore(toNode(n), ref);
  }
  replaceChildren(...nodes: (FakeNode | string | number)[]) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    this.append(...nodes);
  }
  contains(n: FakeNode | null): boolean {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  override get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  override set textContent(v: string) {
    this.replaceChildren(...(v ? [v] : []));
  }
  get innerText() {
    return this.textContent;
  }
  override get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${v.replace(/"/g, '&quot;')}"`).join('');
    return `<${tag}${attrs}>${this.childNodes.map((c) => c.outerHTML).join('')}</${tag}>`;
  }
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string) {
    const e = { type, currentTarget: this, target: this, preventDefault() {} };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  click() {
    this.dispatch('click');
  }
  focus() {
    fakeDocument.activeElement = this;
  }
  blur() {
    if (fakeDocument.activeElement === this) fakeDocument.activeElement = null;
  }
  /** Every element under this one, in document order. */
  descendants(): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const groups = sel.split(',').map((s) => s.trim().split(/\s+/));
    return this.descendants().filter((el) => groups.some((parts) => matchesPath(el, parts, this)));
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  matches(sel: string) {
    return sel.split(',').some((s) => matchesOne(this, s.trim()));
  }
  closest(sel: string): FakeEl | null {
    for (let e: FakeEl | null = this; e; e = e.parentElement) if (e.matches(sel)) return e;
    return null;
  }
}

function matchesOne(el: FakeEl, sel: string): boolean {
  const m = sel.match(/^([a-z0-9-]*)((?:[.#][\w-]+|\[[^\]]+\])*)$/i);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const part of m[2].match(/[.#][\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part[0] === '.' && !el.classList.contains(part.slice(1))) return false;
    if (part[0] === '#' && el.id !== part.slice(1)) return false;
    if (part[0] === '[') {
      const [k, v] = part.slice(1, -1).split('=');
      if (!el.hasAttribute(k)) return false;
      if (v !== undefined && el.getAttribute(k) !== v.replace(/^["']|["']$/g, '')) return false;
    }
  }
  return true;
}

function matchesPath(el: FakeEl, parts: string[], root: FakeEl): boolean {
  if (!matchesOne(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let e = el.parentElement; e && i >= 0 && e !== root; e = e.parentElement) if (matchesOne(e, parts[i])) i--;
  return i < 0;
}

const store = new Map<string, string>();
export const fakeDocument = {
  documentElement: new FakeEl('html'),
  body: null as unknown as FakeEl,
  activeElement: null as FakeEl | null,
  readyState: 'complete',
  nodeType: 9,
  // Enough for DOMPurify to set itself up (ui/markdown.ts, imported along the way); nothing here sanitizes.
  implementation: { createHTMLDocument: () => ({}) },
  createElement: (t: string) => new FakeEl(t),
  createTextNode: (t: string) => new FakeText(t),
  getElementById: (id: string) => fakeDocument.documentElement.querySelector(`#${id}`),
  querySelector: (s: string) => fakeDocument.documentElement.querySelector(s),
  querySelectorAll: (s: string) => fakeDocument.documentElement.querySelectorAll(s),
  addEventListener() {},
  removeEventListener() {},
};
fakeDocument.body = new FakeEl('body');
fakeDocument.documentElement.append(fakeDocument.body);

export function installFakeDom() {
  Object.assign(globalThis, {
    document: fakeDocument,
    window: globalThis,
    Node: FakeNode,
    Element: FakeEl,
    HTMLElement: FakeEl,
    HTMLButtonElement: FakeEl,
    HTMLInputElement: FakeEl,
    HTMLTextAreaElement: FakeEl,
    Text: FakeText,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  if (typeof (globalThis as { location?: unknown }).location === 'undefined') Object.assign(globalThis, { location: { pathname: '/lite', search: '', href: 'http://office/lite', origin: 'http://office' } });
}
