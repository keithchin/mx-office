// MDL's widget-tree shape, read without mxcli: a page, snippet or layout (`create or modify page M.P
// folder '…' ( Title: …, Layout: … ) { container c (Class: …) { … } }`), and a navigation profile
// (`create or modify navigation Responsive home page M.P { menu item 'Home' ( OnClick: … ) }`) both
// nest `keyword [name] [( Key: value, … )] [{ children }]`. This reads that nesting, each item with
// its properties as written and its lines in the text, for the Page view (page-view.ts) and the
// Navigation view (nav-view.ts). Tolerant: what it doesn't understand it skips, and it never throws.
// Pure (no DOM), so it's tested in node.

export interface MdlItem {
  /** The keyword, lower case: container, dataview, datagrid, column, textbox, row, menu item, … */
  kind: string;
  /** The name after the keyword (a widget's name, a menu item's caption), unquoted. */
  name?: string;
  props: Record<string, string>;
  children: MdlItem[];
  /** The item's lines in the text (0-based, inclusive). */
  lines: [number, number];
}

export interface MdlStatement {
  /** The words before its properties or body: create, or, modify, page, M.P, folder, 'Pages', … (strings unquoted). */
  words: string[];
  props: Record<string, string>;
  children: MdlItem[];
  lines: [number, number];
}

const MAX_DEPTH = 60;
const MAX_ITEMS = 8000;
/** Two-word keywords, where the second word isn't the item's name. */
const TWO_WORD = new Set(['menu item']);

/** `'it''s'` → `it's`; anything else as it is. */
export function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t[0] === "'" && t.endsWith("'") && !t.slice(1, -1).replace(/''/g, '').includes("'")) return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t[0] === '"' && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

class Scanner {
  i = 0;
  line = 0;
  items = 0;
  constructor(readonly s: string) {}

  get done() {
    return this.i >= this.s.length;
  }

  /** Skips spaces, newlines and `--` comments (or only to the end of this line with `sameLine`). Returns whether a newline was passed. */
  space(sameLine = false): boolean {
    let nl = false;
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '\n') {
        if (sameLine) return true;
        nl = true;
        this.line++;
        this.i++;
      } else if (c === ' ' || c === '\t' || c === '\r') this.i++;
      else if (c === '-' && s[this.i + 1] === '-') {
        while (this.i < s.length && s[this.i] !== '\n') this.i++;
      } else if (c === '/' && s[this.i + 1] === '*') {
        // A /** documentation */ comment, as mxcli writes above a document.
        const end = s.indexOf('*/', this.i + 2);
        const stop = end < 0 ? s.length : end + 2;
        for (let j = this.i; j < stop; j++) if (s[j] === '\n') this.line++;
        this.i = stop;
      } else break;
    }
    return nl;
  }

  /** Past a quoted string starting at i (its quote char), counting its newlines. */
  private skipString() {
    const s = this.s;
    const q = s[this.i++];
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === '\n') this.line++;
      else if (c === q) {
        if (q === "'" && s[this.i] === "'") this.i++;
        else return;
      }
    }
  }

  /** One word: a quoted string, or a run of anything but spaces, brackets, commas and semicolons. */
  word(): string | null {
    const s = this.s;
    const start = this.i;
    const c = s[this.i];
    if (c === undefined || '(){};,'.includes(c)) return null;
    if (c === "'" || c === '"') {
      this.skipString();
      return unquote(s.slice(start, this.i));
    }
    while (this.i < s.length && !/[\s(){};,]/.test(s[this.i])) this.i++;
    return this.i > start ? s.slice(start, this.i) : null;
  }

  /** The text up to the bracket closing the one at i (i past it afterwards), or null at the end. */
  balanced(): string | null {
    const s = this.s;
    const start = ++this.i;
    let depth = 1;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "'" || c === '"') {
        this.skipString();
        continue;
      }
      if (c === '\n') this.line++;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') {
        if (--depth === 0) {
          this.i++;
          return s.slice(start, this.i - 1);
        }
      }
      this.i++;
    }
    return null;
  }

  /** `( … )` at i: its properties. */
  props(): Record<string, string> {
    const inner = this.balanced();
    return inner === null ? {} : splitProps(inner);
  }

  /** `{ … }` at i: its items, i past the closing brace. */
  body(depth: number): MdlItem[] {
    this.i++;
    const out: MdlItem[] = [];
    for (;;) {
      this.space();
      if (this.done) return out;
      const c = this.s[this.i];
      if (c === '}') {
        this.i++;
        return out;
      }
      if (c === ',' || c === ';' || c === ')') {
        this.i++;
        continue;
      }
      const before = this.i;
      const item = this.item(depth);
      if (item && this.items++ < MAX_ITEMS) out.push(item);
      if (this.i === before) this.i++;
    }
  }

  /** `keyword [name] [( … )] [{ … }]`. */
  item(depth: number): MdlItem | null {
    const first = this.line;
    const words: string[] = [];
    for (;;) {
      if (this.space(true)) break;
      const w = this.word();
      if (w === null) break;
      words.push(w);
    }
    this.space();
    let props: Record<string, string> = {};
    let children: MdlItem[] = [];
    if (this.s[this.i] === '(') {
      props = this.props();
      this.space();
    }
    if (this.s[this.i] === '{') {
      if (depth >= MAX_DEPTH) this.balancedBrace();
      else children = this.body(depth + 1);
    }
    if (!words.length) return null;
    let kind = words[0].toLowerCase();
    let rest = words.slice(1);
    if (rest.length && TWO_WORD.has(`${kind} ${rest[0].toLowerCase()}`)) {
      kind = `${kind} ${rest[0].toLowerCase()}`;
      rest = rest.slice(1);
    }
    const item: MdlItem = { kind, props, children, lines: [first, this.lastLine()] };
    if (rest.length) item.name = rest[0];
    return item;
  }

  /** The line of the last character read (not of the newline after it). */
  lastLine(): number {
    let l = this.line;
    for (let j = this.i - 1; j >= 0 && /\s/.test(this.s[j]); j--) if (this.s[j] === '\n') l--;
    return l;
  }

  /** Past a `{ … }` too deep to read. */
  balancedBrace() {
    let depth = 0;
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === "'" || c === '"') {
        this.skipString();
        continue;
      }
      if (c === '\n') this.line++;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        this.i++;
        return;
      }
      this.i++;
    }
  }
}

/** `Key: value, Key2: (a, b), …` → { Key: 'value', Key2: '(a, b)' }, strings unquoted, whitespace collapsed. */
export function splitProps(inner: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "'" || c === '"') {
      for (i++; i < inner.length; i++) {
        if (inner[i] === c) {
          if (c === "'" && inner[i + 1] === "'") i++;
          else break;
        }
      }
    } else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  for (const p of parts) {
    const m = /^\s*([$\w.]+)\s*:\s*([\s\S]*)$/.exec(p);
    if (!m) continue;
    const raw = m[2].replace(/\s*\n\s*/g, ' ').trim();
    out[m[1]] = unquote(raw);
  }
  return out;
}

/** The statements of an MDL text: each `words [( … )] [{ … }] ;`. */
export function parseMdl(text: string): MdlStatement[] {
  const sc = new Scanner(text.replace(/\r\n/g, '\n'));
  const out: MdlStatement[] = [];
  while (!sc.done) {
    sc.space();
    if (sc.done) break;
    const first = sc.line;
    const words: string[] = [];
    let props: Record<string, string> = {};
    let children: MdlItem[] = [];
    const before = sc.i;
    for (;;) {
      sc.space();
      const c = sc.s[sc.i];
      if (c === undefined || c === ';') break;
      if (c === '(') props = { ...props, ...sc.props() };
      else if (c === '{') children = sc.body(1);
      else if (c === ',' || c === ')' || c === '}') sc.i++;
      else {
        const w = sc.word();
        if (w === null) sc.i++;
        else words.push(w);
      }
    }
    const end = sc.lastLine();
    if (sc.s[sc.i] === ';') sc.i++;
    if (sc.i === before) sc.i++;
    if (words.length || children.length) out.push({ words, props, children, lines: [first, end] });
  }
  return out;
}

/** Each item in the tree, depth first. */
export function* walk(items: MdlItem[]): Generator<MdlItem> {
  for (const it of items) {
    yield it;
    yield* walk(it.children);
  }
}
