// The small rules the Developer view's document relationships are made of (./app-documents.ts puts them
// together): a document's artifact key (its path with a version, date or round suffix taken off), the
// version marker that was taken off, dated runs (a dated folder of screenshots, a file named only by a
// date), the representation a design file is (storyboard, wireframe, prototype, tokens), what a document
// refers to (links, images, stylesheets), and its status where a real source says so. Pure.
//
// Nothing here looks at a file's date: dates come from git (the last commit that touched the file at the
// revision shown) and are only shown, never used to decide that one document replaces another.

import { draftByHead, draftByName } from './deliverables.js';

/** A dated folder or name: 2026-10-18, 2026-10-18-r2, 2026-10-18_night. */
const DATED = /^(\d{4}-\d{2}-\d{2})(?:[-_ ](.+))?$/;
/** A suffix that marks a version of the same document: -v2, _v1.3, -rev4, -r2, -round3, -2026-10-18, -20261018. */
const SUFFIX = /[-_. ](v\d+(?:\.\d+)*|rev\d+|r\d+|round[-_]?\d+|\d{4}-\d{2}-\d{2}(?:[-_]\d{4,6})?|\d{8})$/i;
/** A date in front: 2026-10-18-gate-check. */
const PREFIX = /^(\d{4}-\d{2}-\d{2})[-_ ](?=.)/;

export const DOC_FORMATS = new Set(['md', 'markdown', 'html', 'htm', 'pdf', 'docx', 'txt']);
export const ASSET = /\.(css|scss|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|js)$/i;

export function splitName(path: string): { dir: string; stem: string; ext: string } {
  const slash = path.lastIndexOf('/');
  const dir = slash < 0 ? '' : path.slice(0, slash);
  const base = path.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? { dir, stem: base.slice(0, dot), ext: base.slice(dot + 1).toLowerCase() } : { dir, stem: base, ext: '' };
}

/** The artifact a file is a version of: its stem with version, date and round suffixes taken off (and what was taken). */
export function artifactKey(path: string): { key: string; stem: string; markers: string[]; dateOnly: boolean } {
  const { dir, stem, ext } = splitName(path);
  // Named only by its date (standups/2026-10-23.md): a dated series of the same document in that folder.
  if (DATED.test(stem)) return { key: `${dir}/*.${ext}`.toLowerCase(), stem: dir.slice(dir.lastIndexOf('/') + 1) || stem, markers: [stem], dateOnly: true };
  let s = stem;
  const markers: string[] = [];
  for (let i = 0; i < 4; i++) {
    const m = SUFFIX.exec(s);
    if (!m || m.index === 0) break;
    markers.unshift(m[1]);
    s = s.slice(0, m.index);
  }
  const p = PREFIX.exec(s);
  if (p) {
    markers.unshift(p[1]);
    s = s.slice(p[0].length);
  }
  return { key: `${dir}/${s}.${ext}`.toLowerCase(), stem: s, markers, dateOnly: false };
}

/** A marker as numbers to order versions by (v2 → [2], 2026-10-18 → [20261018]); none → []. */
export function markerOrder(markers: readonly string[]): number[] {
  return markers.flatMap((m) => {
    const d = /^(\d{4})-?(\d{2})-?(\d{2})(?:[-_](\d+))?$/.exec(m);
    if (d) return [Number(`${d[1]}${d[2]}${d[3]}`), Number(d[4] ?? 0)];
    return (m.match(/\d+/g) ?? []).map(Number);
  });
}

export function compareOrder(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** Where a path sits in a dated run (a review round's folder): the folder of runs, the run, its date and tag. */
export function runOf(path: string): { base: string; run: string; date: string; tag?: string } | undefined {
  const parts = path.split('/');
  for (let i = parts.length - 2; i >= 1; i--) {
    const m = DATED.exec(parts[i]);
    if (m) return { base: parts.slice(0, i).join('/'), run: parts.slice(0, i + 1).join('/'), date: m[1], ...(m[2] ? { tag: m[2] } : {}) };
  }
  return undefined;
}

/** The representation a design file is, from its path. */
export function roleOf(path: string, specId?: string): string | undefined {
  const lower = path.toLowerCase();
  const { stem, ext } = splitName(lower);
  if (specId === 'brd-json') return 'BRD source data';
  if (specId === 'brd-report') return 'BRD report';
  if (specId === 'brd-validation') return 'BRD validation report';
  if (specId === 'brd-pdf') return 'BRD for the client (PDF)';
  if (stem === 'page-map' && ext === 'tsv') return 'Page map';
  if (ext === 'css' || ext === 'scss' || /(^|[-_.])tokens?$/.test(stem) || stem.startsWith('design-tokens')) return 'Design tokens';
  if (/(^|\/)storyboard(s)?\//.test(lower) && /^(png|jpe?g|svg|webp)$/.test(ext)) return 'Storyboard frame';
  if (/(^|\/)storyboard[^/]*$/.test(lower)) return 'Storyboard';
  if (/(^|\/)wireframes?\//.test(lower) && (ext === 'html' || ext === 'htm' || ext === 'png' || ext === 'svg')) return 'Wireframe';
  if (/^prototype/.test(stem) && (ext === 'html' || ext === 'htm')) return 'Prototype';
  return undefined;
}

/** The screen a storyboard frame or wireframe shows: its name without a leading frame number. */
export const screenOf = (path: string) => splitName(path).stem.replace(/^\d+[-_ ]+/, '').toLowerCase();

/** What a Markdown, HTML or CSS file refers to inside the project (links, images, stylesheets), as project paths. */
export function referencesOf(path: string, text: string): string[] {
  const { dir } = splitName(path);
  const out = new Set<string>();
  const add = (raw: string) => {
    const r = raw.trim().replace(/^<|>$/g, '').split(/[?#]/)[0];
    if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('/') || r.startsWith('//')) return;
    const parts = (dir ? `${dir}/${r}` : r).split('/');
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (!stack.length) return;
        stack.pop();
      } else stack.push(decodeSafe(p));
    }
    if (stack.length) out.add(stack.join('/'));
  };
  for (const m of text.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) add(m[1]);
  out.delete(path);
  return [...out];
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export interface StatusFound {
  value: 'draft' | 'approved' | 'current' | 'stated';
  text: string;
  source: string;
}

const valueOf = (t: string): StatusFound['value'] => (/\bdraft\b/i.test(t) ? 'draft' : /\bapproved\b/i.test(t) ? 'approved' : /\bcurrent\b/i.test(t) ? 'current' : 'stated');

/** A document's status where the document itself says so: front matter, a Status line, a status meta tag, the DRAFT banner, or its name. */
export function statusOf(path: string, text: string | undefined): StatusFound | undefined {
  if (text) {
    const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm) {
      const st = /^status\s*:\s*["']?([^"'\r\n]+)["']?\s*$/im.exec(fm[1]);
      if (/^approved(_by)?\s*:\s*(true|yes|\S.*)$/im.test(fm[1]) && !/^approved\s*:\s*(false|no)\s*$/im.test(fm[1])) return { value: 'approved', text: st?.[1]?.trim() || 'approved', source: 'front matter' };
      if (st) return { value: valueOf(st[1]), text: st[1].trim(), source: 'front matter' };
    }
    const meta = /<meta\s+name=["']status["']\s+content=["']([^"']+)["']/i.exec(text.slice(0, 4000));
    if (meta) return { value: valueOf(meta[1]), text: meta[1].trim(), source: 'status tag' };
    const head = text.split(/\r?\n/).slice(0, 40).join('\n');
    const line = /^\s*(?:[-*]\s*)?(?:\*\*|__)?status(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*([^\r\n]{1,160})$/im.exec(head);
    if (line) return { value: valueOf(line[1]), text: line[1].replace(/[*_]+/g, '').trim(), source: 'Status line' };
    if (draftByHead(text)) return { value: 'draft', text: 'DRAFT banner', source: 'DRAFT banner' };
  }
  if (draftByName(path)) return { value: 'draft', text: 'draft (by its name)', source: 'file name' };
  return undefined;
}

/** PAGE-MAP.tsv's rows: page, wireframe file (in the map's folder), prototype route. */
export function pageMapRows(text: string): { page: string; wireframe?: string; route?: string }[] {
  const out: { page: string; wireframe?: string; route?: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue;
    const cols = line.split('\t').map((c) => c.trim());
    if (!cols[0] || /^page$/i.test(cols[0])) continue;
    const route = cols.find((c, i) => i > 0 && /^#\//.test(c));
    const wireframe = cols.find((c, i) => i > 0 && /\.(html?|png|svg)$/i.test(c));
    out.push({ page: cols[0], ...(wireframe ? { wireframe } : {}), ...(route ? { route } : {}) });
  }
  return out;
}

/** "18 Oct 2026" from 2026-10-18. */
export function dayLabel(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** A file or folder name in words: brd-report → Brd report, Sheet_Overview → Sheet overview. */
export function wordsOf(name: string): string {
  const w = name.replace(/[-_]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  const out = w.split(/\s+/).map((x, i) => (/^[A-Z0-9]{2,}$/.test(x) ? x : i ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase())).join(' ');
  return out || name;
}

/** "16 Oct 2026" from a time (ms), the same in every browser. */
export const dayOf = (at: number) => dayLabel(new Date(at).toISOString().slice(0, 10));
