// A small, forgiving CSS/SCSS reader for the design-system import (./scan.ts): every declaration with its line,
// the blocks around it (selectors and at-rules, so `.dark`, `[data-theme=dark]` and prefers-color-scheme are
// known), Sass variables and simple Sass maps, @import targets and @font-face blocks. It never evaluates
// anything: no Sass functions, no imports followed. Strings, comments, url(…) and #{…} are skipped over.

export interface Decl {
  prop: string;
  value: string;
  line: number;
  text: string;
  /** The enclosing preludes, outermost first (`@media (prefers-color-scheme: dark)`, `:root`). */
  blocks: string[];
}

export interface CssSink {
  decl(d: Decl): void;
  /** @import / @use: the target as written. */
  imported?(target: string, line: number): void;
  /** A @font-face block's family and sources. */
  fontFace?(family: string, src: string, line: number): void;
}

/** Comments blanked out (newlines kept, so lines still count). `//` comments too in SCSS. */
export function blankComments(text: string, scss: boolean): string {
  let out = text.replace(/\/\*[\s\S]*?(\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));
  if (scss) out = out.replace(/(^|[\s;{}])\/\/[^\n]*/g, (m, pre: string) => pre + ' '.repeat(m.length - pre.length));
  return out;
}

function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** Splits on `sep` outside parentheses and quotes. */
export function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let q = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = '';
    } else if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

/**
 * Reads `text` (CSS or SCSS) and tells `sink` each declaration. `lineBase` is added to every line (a <style>
 * block inside an HTML file). Text lines are kept for provenance, trimmed to 200 characters.
 */
export function readCss(raw: string, sink: CssSink, opts: { scss?: boolean; lineBase?: number } = {}): void {
  const text = blankComments(raw, !!opts.scss);
  const rawLines = raw.split('\n');
  const starts = lineIndex(text);
  const base = opts.lineBase ?? 0;
  const stack: string[] = [];
  let start = 0;
  let depth = 0;
  let q = '';
  let fontFace: { family: string; src: string; line: number } | undefined;

  const statement = (from: number, to: number) => {
    const chunk = text.slice(from, to);
    const lead = chunk.search(/\S/);
    if (lead < 0) return;
    const s = chunk.trim();
    const line = lineAt(starts, from + lead);
    const at = line + base;
    const src = (rawLines[line - 1] ?? s).trim().slice(0, 200);
    if (s.startsWith('@')) {
      const m = /^@(import|use|forward)\s+(.+)$/s.exec(s);
      if (m) sink.imported?.(m[2].trim(), at);
      return;
    }
    const colon = s.indexOf(':');
    if (colon <= 0) return;
    const prop = s.slice(0, colon).trim();
    const value = s.slice(colon + 1).trim();
    if (!/^(--|\$)?[A-Za-z_][\w-]*$/.test(prop) && !/^--[\w-]+$/.test(prop)) return;
    if (fontFace) {
      if (/^font-family$/i.test(prop)) fontFace.family = value.replace(/["']/g, '');
      if (/^src$/i.test(prop)) fontFace.src = value;
      return;
    }
    // A simple Sass map: `$colors: (primary: #123, danger: #c00);` → $colors.primary, $colors.danger.
    if (prop.startsWith('$') && /^\(.*\)\s*(!default)?$/s.test(value)) {
      for (const entry of splitTop(value.replace(/\s*!default$/, '').slice(1, -1), ',')) {
        const c = entry.indexOf(':');
        if (c > 0)
          sink.decl({
            prop: `${prop}.${entry.slice(0, c).trim().replace(/["']/g, '')}`,
            value: entry.slice(c + 1).trim(),
            line: at,
            text: src,
            blocks: [...stack],
          });
      }
      return;
    }
    sink.decl({
      prop,
      value: value.replace(/\s*!default$/, ''),
      line: at,
      text: src,
      blocks: [...stack],
    });
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '\\') i++;
      else if (c === q) q = '';
      continue;
    }
    if (c === '"' || c === "'") q = c;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === '#' && text[i + 1] === '{') {
      const end = text.indexOf('}', i);
      if (end > 0) i = end;
    } else if (depth > 0) continue;
    else if (c === ';') {
      statement(start, i);
      start = i + 1;
    } else if (c === '{') {
      const prelude = text.slice(start, i).trim().replace(/\s+/g, ' ');
      stack.push(prelude);
      if (/^@font-face\b/i.test(prelude)) fontFace = { family: '', src: '', line: lineAt(starts, i) + base };
      start = i + 1;
    } else if (c === '}') {
      statement(start, i);
      const was = stack.pop();
      if (was && /^@font-face\b/i.test(was) && fontFace) {
        sink.fontFace?.(fontFace.family, fontFace.src, fontFace.line);
        fontFace = undefined;
      }
      start = i + 1;
    }
  }
  statement(start, text.length);
}

/** Inline `style="…"` declarations (HTML), each on the attribute's line. */
export function readInline(style: string, line: number, text: string, sink: CssSink): void {
  for (const part of splitTop(style, ';')) {
    const c = part.indexOf(':');
    if (c > 0)
      sink.decl({
        prop: part.slice(0, c).trim(),
        value: part.slice(c + 1).trim(),
        line,
        text,
        blocks: ['[style]'],
      });
  }
}

/** A block that's the dark variant: prefers-color-scheme: dark, .dark, [data-theme=dark] and the like. */
export function darkReason(blocks: readonly string[]): string | undefined {
  for (const b of blocks) {
    if (/prefers-color-scheme\s*:\s*dark/i.test(b)) return '@media (prefers-color-scheme: dark)';
    const m = /(\.dark(?:-mode|-theme)?\b|\.theme-dark\b|\[data-(?:bs-)?(?:theme|mode|color-scheme)\s*=\s*["']?dark["']?\])/i.exec(b);
    if (m) return m[1];
  }
  return undefined;
}

/** The innermost selector is the page itself (html, body, :root). */
export const onPage = (blocks: readonly string[]) => {
  const last = [...blocks].reverse().find((b) => !b.startsWith('@'));
  return !!last && last.split(',').some((s) => /^\s*(html|body|:root|:host)\s*$/i.test(s.replace(/\[data-[^\]]*\]|\.dark\b|\.theme-dark\b/gi, '').trim() || ':root'));
};
