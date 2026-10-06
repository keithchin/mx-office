// A deliverable's bytes for the viewer, from wherever the scan found it: the main checkout, a team
// member's worktree, or a branch (git cat-file). Only paths the catalog or the extras allow, only
// sources the scan listed, and never past a size cap. An HTML report is made self-contained before
// it's served (its relative stylesheets, scripts and pictures inlined), because it's shown in a
// sandboxed iframe with no origin, which can't fetch anything from the office.

import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { insideCheckout } from '../changes.js';
import { isDeliverablePath, kindOf, safeRelPath } from '../../shared/deliverables.js';
import { blobOnBranch, safeBranch, sizeOnBranch } from './git.js';

/** Caps, in bytes. */
export const CAPS = { file: 25 * 1024 * 1024, html: 5 * 1024 * 1024, text: 2 * 1024 * 1024, csv: 5 * 1024 * 1024, inlined: 2 * 1024 * 1024, inlinedTotal: 10 * 1024 * 1024 };

/** Where to read from: a checkout folder, or a branch of the main checkout. */
export type Source = { dir: string } | { repo: string; branch: string };

export type Read = { body: Buffer } | { status: number; error: string };

/** The bytes of `file` from `source`, when it's a deliverable path and no bigger than `max`. */
export async function readDeliverable(source: Source, file: string, max: number): Promise<Read> {
  if (!safeRelPath(file) || !isDeliverablePath(file)) return { status: 404, error: 'That is not a deliverable' };
  return readAny(source, file, max);
}

/** The same without the deliverable check: for what a report pulls in (its ds.css), still inside the project. */
async function readAny(source: Source, file: string, max: number): Promise<Read> {
  if (!safeRelPath(file)) return { status: 404, error: 'Not in the project' };
  const tooBig = { status: 413, error: `That file is over ${Math.round(max / 1024 / 1024)} MB` };
  if ('dir' in source) {
    const abs = await insideCheckout(source.dir, file);
    if (!abs) return { status: 404, error: 'That file is not there' };
    try {
      const s = await stat(abs);
      if (!s.isFile()) return { status: 404, error: 'That is not a file' };
      if (s.size > max) return tooBig;
      return { body: await readFile(abs) };
    } catch {
      return { status: 404, error: 'That file is gone' };
    }
  }
  if (!safeBranch(source.branch)) return { status: 400, error: 'Bad branch' };
  const size = await sizeOnBranch(source.repo, source.branch, file);
  if (size === undefined) return { status: 404, error: 'That file is not on the branch' };
  if (size > max) return tooBig;
  const body = await blobOnBranch(source.repo, source.branch, file, max);
  return body ? { body } : { status: 500, error: 'git could not read it' };
}

const IMAGE_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };

/** The content type a deliverable is served as. */
export function contentType(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase();
  if (IMAGE_TYPE[ext]) return IMAGE_TYPE[ext];
  switch (kindOf(file)) {
    case 'html':
      return 'text/html; charset=utf-8';
    case 'pdf':
      return 'application/pdf';
    case 'md':
    case 'csv':
    case 'json':
    case 'text':
      return 'text/plain; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** A reference in a report to another file of the project, relative to the report; undefined for anything else. */
export function resolveRef(from: string, ref: string): string | undefined {
  const r = ref.trim().split(/[?#]/)[0];
  if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(r);
  } catch {
    return undefined;
  }
  const joined = decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(from), decoded);
  const norm = path.posix.normalize(joined);
  return safeRelPath(norm) ? norm : undefined;
}

/** A Mermaid build on jsDelivr or unpkg, as the toolkit's blueprint.html loads it. */
export const MERMAID_CDN = /^https:\/\/(cdn\.jsdelivr\.net\/npm|unpkg\.com)\/mermaid(@[\w.-]+)?\/dist\/mermaid(\.min)?\.js(\?.*)?$/;
let mermaidText: Promise<string | undefined> | undefined;
/** The office's own Mermaid (a dependency of the office), read once. */
export function mermaidJs(): Promise<string | undefined> {
  mermaidText ??= (async () => {
    try {
      return await readFile(createRequire(import.meta.url).resolve('mermaid/dist/mermaid.min.js'), 'utf8');
    } catch {
      return undefined;
    }
  })();
  return mermaidText;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
const attrValue = (m: RegExpExecArray | null) => (m ? (m[2] ?? m[3] ?? m[4] ?? '') : undefined);
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * `html` (the report at `file`) with its relative stylesheets, scripts and pictures inlined from the
 * same source, each within the caps. Anything it can't inline is left as it was, and the page's CSP
 * blocks it.
 */
export async function inlineHtml(source: Source, file: string, html: string): Promise<string> {
  let budget = CAPS.inlinedTotal;
  const cache = new Map<string, Promise<Buffer | undefined>>();
  const load = (ref: string | undefined) => {
    if (!ref) return Promise.resolve(undefined);
    let p = cache.get(ref);
    if (!p) {
      p = readAny(source, ref, CAPS.inlined).then((r) => {
        if (!('body' in r) || r.body.length > budget) return undefined;
        budget -= r.body.length;
        return r.body;
      });
      cache.set(ref, p);
    }
    return p;
  };
  const replaceAsync = async (text: string, re: RegExp, fn: (m: RegExpExecArray) => Promise<string>) => {
    const parts: (string | Promise<string>)[] = [];
    let at = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      parts.push(text.slice(at, m.index), fn(m));
      at = m.index + m[0].length;
    }
    parts.push(text.slice(at));
    return (await Promise.all(parts)).join('');
  };
  // <link rel="stylesheet" href="../ds.css"> → <style>…</style>
  let out = await replaceAsync(html, /<link\b[^>]*>/gi, async (m) => {
    const tag = m[0];
    if (!/stylesheet/i.test(attrValue(attr(tag, 'rel')) ?? '')) return tag;
    const ref = resolveRef(file, attrValue(attr(tag, 'href')) ?? '');
    const css = ref && /\.css$/i.test(ref) ? await load(ref) : undefined;
    return css ? `<style data-from="${escapeAttr(ref!)}">\n${css.toString('utf8').replace(/<\/style/gi, '<\\/style')}\n</style>` : tag;
  });
  // <script src="x.js"></script> → <script>…</script>
  out = await replaceAsync(out, /<script\b([^>]*)>\s*<\/script>/gi, async (m) => {
    const src = attrValue(attr(m[0], 'src'));
    if (src === undefined) return m[0];
    // Mermaid from a CDN (a blueprint.html, per the toolkit): the office's own copy, since the page can't reach the network.
    if (MERMAID_CDN.test(src.trim())) {
      const local = await mermaidJs();
      return local ? `<script data-from="mermaid">${local.replace(/<\/script/gi, '<\\/script')}</script>` : m[0];
    }
    const ref = resolveRef(file, src);
    const js = ref && /\.m?js$/i.test(ref) ? await load(ref) : undefined;
    return js ? `<script data-from="${escapeAttr(ref!)}">${js.toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>` : m[0];
  });
  // <img src="img-001.svg"> → a data: URL
  out = await replaceAsync(out, /<img\b[^>]*>/gi, async (m) => {
    const tag = m[0];
    const found = attr(tag, 'src');
    const ref = resolveRef(file, attrValue(found) ?? '');
    const type = ref ? IMAGE_TYPE[ref.slice(ref.lastIndexOf('.') + 1).toLowerCase()] : undefined;
    if (!found || !type) return tag;
    const img = await load(ref);
    return img ? tag.replace(found[0], ` src="data:${type};base64,${img.toString('base64')}"`) : tag;
  });
  // With no origin the page has no storage, and a report's theme toggle that reads it would throw.
  const at = /<head\b[^>]*>/i.exec(out);
  return at ? out.slice(0, at.index + at[0].length) + STORAGE_SHIM + out.slice(at.index + at[0].length) : STORAGE_SHIM + out;
}

/** localStorage and sessionStorage kept in memory, for a page in a sandbox without an origin. */
const STORAGE_SHIM =
  '<script>(function(){try{window.localStorage;return}catch(e){}var m=function(){var d=new Map();return{getItem:function(k){return d.has(String(k))?d.get(String(k)):null},setItem:function(k,v){d.set(String(k),String(v))},removeItem:function(k){d.delete(String(k))},clear:function(){d.clear()},key:function(i){return Array.from(d.keys())[i]||null},get length(){return d.size}}};try{Object.defineProperty(window,"localStorage",{value:m(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:m(),configurable:true})}catch(e){}})()</script>';

/** The CSP an HTML report is served with: nothing from the network, inline styles and scripts only, no origin. */
export const HTML_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; frame-ancestors 'self'; form-action 'none'; base-uri 'none'; sandbox allow-scripts";

/** At most `maxRows` rows of a CSV (RFC 4180: quotes, doubled quotes, newlines in quotes), each at most `maxCols` wide. */
export function parseCsv(text: string, maxRows = 200, maxCols = 50): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  // A semicolon file (Excel in many locales) when the header has more of those than commas.
  const firstLine = s.slice(0, s.indexOf('\n') >>> 0);
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const endRow = () => {
    row.push(cell);
    rows.push(row.slice(0, maxCols));
    row = [];
    cell = '';
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRow();
      if (rows.length > maxRows) break;
    } else cell += c;
  }
  if (rows.length <= maxRows && (cell || row.length)) endRow();
  return { rows: rows.slice(0, maxRows), more: rows.length > maxRows };
}
