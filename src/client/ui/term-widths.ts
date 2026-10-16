// The glyph widths xterm's DOM renderer has measured, carried from one terminal to the next. The renderer
// measures every character it draws, in every variant (bold, italic), once per terminal: it writes the
// character into a hidden span and reads its width, and each read makes the browser lay the page out
// again. A fresh terminal of a long, colourful session measured a hundred and more of them in its first
// frame, and with the page's styles of the time that frame took over a second (the Command Center's
// "page froze" incidents, the terminal-freeze pass, 2026-10-16). The team-lead panel makes a fresh
// terminal on every project switch and every time its box is shown again (pm/term-park.ts), so the
// widths it measured once are handed to the next one with the same font, and kept for the next visit
// (this browser only). A width is the same for the same font, size, weights, cell size and pixel ratio,
// all of which are in the key. A terminal with nothing kept yet still measures less: in a monospace font
// every printable ASCII character is as wide as a W, so W and i are measured in each variant and, when
// they agree (the font is monospace), the rest of ASCII takes that width (seedMonospace). The renderer's cache is internal to xterm.js: if a new version moves it,
// nothing is carried and every terminal measures for itself, as before (tests/terminal-freeze.test.ts
// checks the installed version still has it).

import type { Terminal } from '@xterm/xterm';

/** xterm.js's width cache (src/browser/renderer/dom/WidthCache.ts): `_flat` for plain characters below 256, `_holey` for the rest. */
interface WidthCache {
  _flat: Float32Array;
  _holey: Map<string, number> | undefined;
  _font: string;
  _fontSize: number;
  _weight: unknown;
  _weightBold: unknown;
  get(c: string, bold: boolean, italic: boolean): number;
}

/** What xterm.js puts in `_flat` for a character it hasn't measured. */
const UNSET = -9999;
const STORE_KEY = 'agent-office.term-widths';
/** Fonts remembered at most (the panel's, the full window's, a card's preview, a phone's). */
const MAX_FONTS = 6;

export interface Widths {
  flat: [number, number][];
  holey: [string, number][];
}

/** The renderer's width cache, or undefined when the terminal has none (not opened) or xterm.js keeps it elsewhere. */
function cacheOf(term: Terminal): { cache: WidthCache; cell: number } | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rs = (term as any)?._core?._renderService;
    const cache = rs?._renderer?.value?._widthCache as WidthCache | undefined;
    const cell = Number(rs?.dimensions?.css?.cell?.width);
    if (!cache || !(cache._flat instanceof Float32Array) || !(cache._holey instanceof Map) || !(cell > 0)) return undefined;
    return { cache, cell };
  } catch {
    return undefined;
  }
}

/** The font a width belongs to. */
export function widthKey(c: Pick<WidthCache, '_font' | '_fontSize' | '_weight' | '_weightBold'>, cell: number, dpr: number): string {
  return `${c._font}|${c._fontSize}|${String(c._weight)}|${String(c._weightBold)}|${cell.toFixed(3)}|${dpr}`;
}

/** Widths measured so far, by font. */
let known: Map<string, Widths> | undefined;

function load(): Map<string, Widths> {
  if (known) return known;
  known = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as [string, Widths][];
    if (Array.isArray(raw)) for (const [k, w] of raw.slice(-MAX_FONTS)) if (typeof k === 'string' && Array.isArray(w?.flat) && Array.isArray(w?.holey)) known.set(k, w);
  } catch {
    // none kept (a private window, cleared site data): measured again
  }
  return known;
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...load()].slice(-MAX_FONTS)));
  } catch {
    // only for this visit
  }
}

/** Puts `w`'s widths into a cache where it has none yet; returns how many. Pure on its arguments, so a test can pin it. */
export function fillWidths(flat: Float32Array, holey: Map<string, number>, w: Widths): number {
  let n = 0;
  for (const [i, v] of w.flat) if (i >= 0 && i < flat.length && v > 0 && flat[i] === UNSET) ((flat[i] = v), n++);
  for (const [k, v] of w.holey) if (v > 0 && !holey.has(k)) (holey.set(k, v), n++);
  return n;
}

/** What a cache has measured (widths above 0 only: a 0 is a box that wasn't laid out). */
export function readWidths(flat: Float32Array, holey: Map<string, number>, into: Widths = { flat: [], holey: [] }): Widths {
  const f = new Map(into.flat);
  const h = new Map(into.holey);
  flat.forEach((v, i) => v > 0 && f.set(i, v));
  for (const [k, v] of holey) if (v > 0) h.set(k, v);
  return { flat: [...f], holey: [...h] };
}

/** The variants of a character xterm.js keeps apart, and their key's suffix in `_holey`. */
const VARIANTS: [boolean, boolean, string][] = [
  [false, false, ''],
  [true, false, 'B'],
  [false, true, 'I'],
  [true, true, 'BI'],
];

/**
 * In a monospace font, printable ASCII all takes the width of W: measures W and i in each variant and, where
 * they agree, fills in the rest without measuring each one. Returns how many it filled in.
 */
export function seedMonospace(cache: Pick<WidthCache, '_flat' | '_holey' | 'get'>): number {
  let n = 0;
  for (const [bold, italic, suffix] of VARIANTS) {
    const w = cache.get('W', bold, italic);
    if (!(w > 0) || Math.abs(cache.get('i', bold, italic) - w) > 0.01 || !cache._holey) continue;
    for (let cp = 32; cp < 127; cp++) {
      const ch = String.fromCharCode(cp);
      if (!suffix) {
        if (cache._flat[cp] === UNSET) ((cache._flat[cp] = w), n++);
      } else if (!cache._holey.has(ch + suffix)) (cache._holey.set(ch + suffix, w), n++);
    }
  }
  return n;
}

/** Right after `term.open()`: gives it the widths terminals with its font measured before. */
export function reuseWidths(term: Terminal): void {
  const c = cacheOf(term);
  if (!c) return;
  const w = load().get(widthKey(c.cache, c.cell, devicePixelRatio));
  if (w && c.cache._holey) fillWidths(c.cache._flat, c.cache._holey, w);
  try {
    seedMonospace(c.cache);
  } catch {
    // measured one by one, as before
  }
}

/** Before a terminal goes (or once it has drawn): keeps what it measured for the next one with its font. */
export function keepWidths(term: Terminal | null | undefined): void {
  const c = term && cacheOf(term);
  if (!c || !c.cache._holey) return;
  const k = widthKey(c.cache, c.cell, devicePixelRatio);
  const all = load();
  const before = all.get(k);
  const next = readWidths(c.cache._flat, c.cache._holey, before);
  if (before && next.flat.length === before.flat.length && next.holey.length === before.holey.length) return;
  all.delete(k);
  all.set(k, next);
  save();
}
