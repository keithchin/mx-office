// Import a design system from a folder (docs/site/using-the-office/design-systems.md#import-from-a-folder): the
// path check, the bounded walk and the scan. Read only: nothing is written in the folder, nothing in it is run
// or fetched. Text files only (CSS, SCSS, HTML, design-token JSON, a Tailwind config's literal objects); links
// and junctions are never followed and a file whose real path leaves the folder is refused; dependencies, build
// output, secrets-like and large files are skipped. fs/promises throughout, one file parsed per turn of the
// event loop, so a folder never holds the office up; caps on entries, files and bytes keep it bounded.

import { createHash } from 'node:crypto';
import { opendir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isSecretName, SKIP_DIRS } from '../../../shared/source-folder.js';
import { coloursIn, toHexColour } from '../../../shared/design/import/colour.js';
import { SKIP_LIST_MAX, type FoundColour, type FoundValue, type FoundVar, type ImportScan, type Scheme, type SourceFormat, type UseKind } from '../../../shared/design/import/types.js';
import { checkSourcePath, inside, type OfficeFolders } from '../../wizard/source-folder.js';
import { darkReason, onPage, readCss, readInline, type CssSink, type Decl } from './css.js';
import { readTailwind } from './tailwind.js';
import { readTokensJson } from './tokens-json.js';

export interface ImportCaps {
  /** Folder entries looked at, at most. */
  entries: number;
  /** Text files read, at most. */
  files: number;
  /** One file, at most. */
  fileBytes: number;
  /** All files read, at most. */
  bytes: number;
  depth: number;
}
export const IMPORT_CAPS: ImportCaps = {
  entries: 5000,
  files: 300,
  fileBytes: 1024 * 1024,
  bytes: 8 * 1024 * 1024,
  depth: 10,
};

const FONT_FILE = /\.(woff2?|ttf|otf|eot)$/i;
const IMAGE = /\.(svg|png|jpe?g|webp|gif|ico)$/i;
const TAILWIND = /^tailwind\.config\.(js|cjs|mjs|ts)$/i;
/** JSON that's never design tokens. */
const NOT_TOKENS = /^(package(-lock)?|tsconfig.*|jsconfig|composer|manifest|\.?eslintrc.*|\.?prettierrc.*|angular|vercel|netlify|firebase|renovate|lerna|nx|turbo|project)\.json$/i;

export function formatOf(name: string): SourceFormat | undefined {
  if (TAILWIND.test(name)) return 'tailwind';
  const ext = path.extname(name).toLowerCase();
  if (ext === '.css') return 'css';
  if (ext === '.scss') return 'scss';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.json' && !NOT_TOKENS.test(name)) return 'json';
  return undefined;
}

/** Why `raw` can't be imported from, or its real path and whether it's a folder or one file. Nothing is read. */
export async function checkImportPath(raw: unknown, office: OfficeFolders): Promise<{ path: string; kind: 'folder' | 'file' } | { error: string }> {
  const typed = typeof raw === 'string' ? raw.trim().replace(/^"(.*)"$/, '$1') : '';
  if (!typed) return { error: 'Type the folder’s (or file’s) full path' };
  if (typed.length > 400) return { error: 'That path is too long' };
  if (!path.isAbsolute(typed) || (process.platform === 'win32' && !/^[a-zA-Z]:[\\/]/.test(typed))) return { error: 'Use the full path, like C:\\work\\brand-site' };
  let real: string;
  let isDir: boolean;
  try {
    real = await realpath(typed);
    const st = await stat(real);
    if (!st.isDirectory() && !st.isFile()) return { error: `${typed} isn’t a folder or a file` };
    isDir = st.isDirectory();
  } catch {
    return {
      error: `There’s nothing at ${typed} on the office’s machine (or it can’t be read)`,
    };
  }
  if (isDir) {
    const c = await checkSourcePath(real, office);
    return 'error' in c
      ? {
          error: c.error.replace(/source folder/g, 'design folder').replace(/the app’s own folder/g, 'the design files’ own folder'),
        }
      : { path: c.path, kind: 'folder' };
  }
  const name = path.basename(real);
  if (isSecretName(name)) return { error: 'That looks like a secrets file: it’s never read' };
  if (!formatOf(name))
    return {
      error: 'Only .css, .scss, .html, .htm, design-token .json and tailwind.config.* files can be imported',
    };
  if (inside(real, office.dataDir) || inside(real, office.projectsDir)) return { error: 'That file is inside the office’s own folders' };
  return { path: real, kind: 'file' };
}

const turn = () => new Promise<void>((r) => setImmediate(r));

type Found = { abs: string; rel: string; format: SourceFormat; size: number };

/** The walk: which files will be read, what was left out and why. */
async function walk(root: string, caps: ImportCaps, scan: ImportScan): Promise<Found[]> {
  const out: Found[] = [];
  let entries = 0;
  const skip = (rel: string, reason: string) => {
    scan.skippedCounts[reason] = (scan.skippedCounts[reason] ?? 0) + 1;
    if (scan.skipped.length < SKIP_LIST_MAX) scan.skipped.push({ path: rel, reason });
  };
  const visit = async (dir: string, rel: string, depth: number): Promise<void> => {
    const d = await opendir(dir);
    for await (const e of d) {
      if (++entries > caps.entries) {
        scan.truncated ??= `Stopped after ${caps.entries.toLocaleString('en-US')} entries: point at the design files’ own folder`;
        return;
      }
      const r = rel ? `${rel}/${e.name}` : e.name;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) skip(r, 'link (never followed)');
      else if (e.isDirectory()) {
        if ((SKIP_DIRS as readonly string[]).includes(e.name) || e.name.startsWith('.')) scan.skippedCounts['dependencies, build output or hidden folder'] = (scan.skippedCounts['dependencies, build output or hidden folder'] ?? 0) + 1;
        else if (depth >= caps.depth) skip(r, 'too deep');
        else await visit(abs, r, depth + 1);
      } else if (e.isFile()) {
        if (isSecretName(e.name)) skip(r, 'secrets-like (never read)');
        else if (FONT_FILE.test(e.name)) scan.notImported.fonts.push(r);
        else if (IMAGE.test(e.name)) {
          if (/logo|brand|mark/i.test(e.name)) scan.notImported.logos.push(r);
        } else {
          const format = formatOf(e.name);
          if (!format) skip(r, 'not a design file');
          else {
            const size = (await stat(abs)).size;
            if (size > caps.fileBytes) skip(r, 'too large');
            else out.push({ abs, rel: r, format, size });
          }
        }
      } else skip(r, 'not a plain file');
      if (out.length >= caps.files * 3) return;
    }
  };
  await visit(root, '', 0);
  return out;
}

const USE: [RegExp, UseKind][] = [
  [/^background(-color|-image)?$/i, 'background'],
  [/^color$/i, 'text'],
  [/^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?)$/i, 'border'],
  [/^(fill|stroke|box-shadow|text-decoration-color|caret-color|accent-color|column-rule-color)$/i, 'other'],
];
const useOf = (prop: string) => USE.find(([re]) => re.test(prop))?.[1];
const CONTROL = /(^|[\s.#,>+~(-])(button|btn|input|select|textarea|form-control|control)\b/i;
const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g;
const SASS_REF = /\$[A-Za-z_][\w-]*(?:\.[\w-]+)?/g;

/** What the scan gathers while it reads; turned into an ImportScan at the end. */
class Collector {
  css = {
    light: new Map<string, FoundVar>(),
    dark: new Map<string, FoundVar>(),
  };
  others: FoundVar[] = [];
  uses = new Map<string, Partial<Record<UseKind, number>>>();
  colours = new Map<string, FoundColour>();
  fonts = new Map<string, FoundValue>();
  radii = new Map<string, FoundValue>();
  heights = new Map<string, FoundValue>();
  darkHow = new Set<string>();
  remote: string[] = [];
  fontFaces = new Set<string>();

  sink(file: string, origin: SourceFormat): CssSink {
    return {
      decl: (d) => this.decl(file, origin, d),
      imported: (target) => {
        const m = /^(?:url\()?\s*["']?((?:https?:)?\/\/[^"')\s]+)/i.exec(target);
        if (m && this.remote.length < 50) this.remote.push(`${file}: ${m[1].slice(0, 200)}`);
      },
      fontFace: (family, src, line) => {
        if (family) this.fontFaces.add(`${family} (@font-face in ${file}:${line})`);
        if (/https?:\/\//i.test(src) && this.remote.length < 50) this.remote.push(`${file}: @font-face ${family || ''} from the web`.trim());
      },
    };
  }

  private bump(map: Map<string, FoundValue>, value: string, file: string, d: Decl, strong: boolean, name?: string) {
    const v = value.trim().slice(0, 200);
    if (!v || /^(inherit|initial|unset|revert|0|none|auto)$/i.test(v)) return;
    const key = `${name ?? ''}|${v}`;
    const had = map.get(key);
    if (had) {
      had.count++;
      had.strong ||= strong;
    } else
      map.set(key, {
        value: v,
        count: 1,
        loc: { file, line: d.line },
        text: d.text,
        ...(strong ? { strong } : {}),
        ...(name ? { name } : {}),
      });
  }

  decl(file: string, origin: SourceFormat, d: Decl) {
    const dark = darkReason(d.blocks);
    if (dark) this.darkHow.add(dark);
    const scheme: Scheme = dark ? 'dark' : 'light';
    const page = onPage(d.blocks);
    const loc = { file, line: d.line };
    if (d.prop.startsWith('--') || d.prop.startsWith('$')) {
      const v: FoundVar = {
        name: d.prop,
        raw: d.value,
        value: d.value,
        scheme,
        loc,
        text: d.text,
        origin,
      };
      if (v.name.startsWith('$')) this.others.push(v);
      else this.css[v.scheme].set(v.name, v);
      return;
    }
    const use = useOf(d.prop);
    if (use) {
      for (const m of d.value.matchAll(VAR_REF)) this.use(m[1], use);
      for (const m of d.value.matchAll(SASS_REF)) this.use(m[0], use);
      const literal = d.value.replace(VAR_REF, ' ').replace(SASS_REF, ' ');
      for (const hex of coloursIn(literal)) {
        const key = `${scheme}|${hex}`;
        const c = this.colours.get(key) ?? {
          hex,
          count: 0,
          uses: { background: 0, text: 0, border: 0, other: 0 },
          scheme,
          loc,
          text: d.text,
        };
        c.count++;
        c.uses[use]++;
        if (page) (c.page ??= {})[use] = (c.page[use] ?? 0) + 1;
        this.colours.set(key, c);
      }
    }
    const prop = d.prop.toLowerCase();
    if (prop === 'font-family' && !dark) this.bump(this.fonts, d.value, file, d, page);
    else if (/^(-webkit-)?border-radius$/.test(prop)) this.bump(this.radii, d.value, file, d, false);
    else if ((prop === 'height' || prop === 'min-height') && CONTROL.test(d.blocks.at(-1) ?? '')) this.bump(this.heights, d.value, file, d, false);
  }

  use(name: string, kind: UseKind) {
    const u = this.uses.get(name) ?? {};
    u[kind] = (u[kind] ?? 0) + 1;
    this.uses.set(name, u);
  }

  /** var() and $var chains resolved within the folder; then names that say font, radius or height. */
  finish(): FoundVar[] {
    const sass = new Map(this.others.filter((v) => v.name.startsWith('$')).map((v) => [v.name, v]));
    const resolve = (value: string, scheme: Scheme, depth = 0): string => {
      if (depth > 10) return value;
      let out = value.replace(VAR_REF, (all, name: string, fallback?: string) => {
        const v = (scheme === 'dark' ? this.css.dark.get(name) : undefined) ?? this.css.light.get(name);
        if (v) return resolve(v.raw, scheme, depth + 1);
        return fallback !== undefined ? resolve(fallback.trim(), scheme, depth + 1) : all;
      });
      out = out.replace(SASS_REF, (all) => {
        const v = sass.get(all);
        return v && v.raw !== value ? resolve(v.raw, scheme, depth + 1) : all;
      });
      return out;
    };
    const all = [...this.css.light.values(), ...this.css.dark.values(), ...this.others];
    for (const v of all) {
      if (v.origin === 'css' || v.origin === 'scss' || v.origin === 'html') v.value = resolve(v.raw, v.scheme);
      const hex = toHexColour(v.value);
      if (hex && (!v.type || v.type === 'color')) v.hex = hex;
      const u = this.uses.get(v.name);
      if (u) v.uses = u;
      const n = v.name.toLowerCase();
      const d: Decl = {
        prop: v.name,
        value: v.value,
        line: v.loc.line,
        text: v.text,
        blocks: [],
      };
      if (v.scheme === 'dark') continue;
      if (/font-?family|(^|[-.$])font-(sans|base|body|primary|text)$|^fontfamily\.|type\s*=\s*fontfamil/.test(n) || v.type === 'fontFamily' || v.type === 'fontFamilies') this.bump(this.fonts, v.value, v.loc.file, d, true, v.name);
      else if (/radius|rounded/.test(n) || v.type === 'borderRadius') this.bump(this.radii, v.value, v.loc.file, d, true, v.name);
      else if (/(control|input|btn|button|field|row)-?height/.test(n)) this.bump(this.heights, v.value, v.loc.file, d, true, v.name);
    }
    // Font stacks written as var(--font): resolved too, so the same stack under its name and in a rule is one.
    for (const [k, f] of [...this.fonts]) {
      if (!f.value.includes('var(') && !f.value.includes('$')) continue;
      this.fonts.delete(k);
      const value = resolve(f.value, 'light').slice(0, 200);
      const had = [...this.fonts.values()].find((x) => x.value === value);
      if (had) {
        had.count += f.count;
        had.strong ||= f.strong;
      } else if (!/var\(|\$/.test(value)) this.fonts.set(`${f.name ?? ''}|${value}`, { ...f, value });
    }
    return all;
  }
}

function readHtml(text: string, file: string, c: Collector) {
  const lineOf = (pos: number) => text.slice(0, pos).split('\n').length;
  for (const m of text.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) {
    const at = m.index! + m[0].indexOf('>') + 1;
    readCss(m[1], c.sink(file, 'html'), { lineBase: lineOf(at) - 1 });
  }
  const lines = text.split('\n');
  for (const m of text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const line = lineOf(m.index!);
    readInline(m[1] ?? m[2] ?? '', line, (lines[line - 1] ?? '').trim().slice(0, 200), c.sink(file, 'html'));
  }
  for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
    const href = /href\s*=\s*["']((?:https?:)?\/\/[^"']+)/i.exec(m[0]);
    if (href && /stylesheet|preload|font/i.test(m[0]) && c.remote.length < 50) c.remote.push(`${file}: ${href[1].slice(0, 200)}`);
  }
  for (const m of text.matchAll(/<meta\b[^>]*name\s*=\s*["']theme-color["'][^>]*>/gi)) {
    const content = /content\s*=\s*["']([^"']+)/i.exec(m[0]);
    const line = lineOf(m.index!);
    if (content)
      c.others.push({
        name: 'meta:theme-color',
        raw: content[1],
        value: content[1],
        scheme: /dark/i.test(m[0]) ? 'dark' : 'light',
        loc: { file, line },
        text: (lines[line - 1] ?? '').trim().slice(0, 200),
        origin: 'html',
      });
  }
}

function readJson(text: string, file: string, c: Collector): boolean {
  const tokens = readTokensJson(text);
  if (!tokens?.length) return false;
  for (const t of tokens) {
    if (t.dark) c.darkHow.add(`a dark token set (${file})`);
    c.others.push({
      name: t.path,
      raw: t.value,
      value: t.value,
      scheme: t.dark ? 'dark' : 'light',
      loc: { file, line: t.line },
      text: t.text,
      origin: 'json',
      ...(t.type ? { type: t.type } : {}),
    });
  }
  return true;
}

function readTw(text: string, file: string, c: Collector): number {
  const { entries, skipped } = readTailwind(text);
  for (const e of entries) {
    const name = e.path.replace(/\.DEFAULT$/, '');
    c.others.push({
      name,
      raw: e.value,
      value: e.value,
      scheme: /(^|\.)dark(\.|$)/i.test(e.path) ? 'dark' : 'light',
      loc: { file, line: e.line },
      text: e.text,
      origin: 'tailwind',
      ...(e.section === 'fontFamily' ? { type: 'fontFamily' } : e.section === 'borderRadius' ? { type: 'borderRadius' } : { type: 'color' }),
    });
  }
  return entries.length ? entries.length : skipped ? -1 : 0;
}

/** Scans a folder (or one file) checked by checkImportPath. Never throws for what's in the folder: errors are skips. */
export async function scanDesignSource(source: string, checked: { path: string; kind: 'folder' | 'file' }, caps: ImportCaps = IMPORT_CAPS, now = () => new Date()): Promise<ImportScan | { error: string }> {
  const scan: ImportScan = {
    source,
    kind: checked.kind,
    scannedAt: now().toISOString(),
    files: [],
    skipped: [],
    skippedCounts: {},
    vars: [],
    colours: [],
    fonts: [],
    radii: [],
    heights: [],
    darkHow: [],
    remote: [],
    notImported: { fonts: [], logos: [], layouts: [] },
  };
  let found: Found[];
  const root = checked.kind === 'folder' ? checked.path : path.dirname(checked.path);
  try {
    if (checked.kind === 'folder') found = await walk(checked.path, caps, scan);
    else {
      const size = (await stat(checked.path)).size;
      if (size > caps.fileBytes)
        return {
          error: `That file is over ${Math.round(caps.fileBytes / 1024)} KB`,
        };
      found = [
        {
          abs: checked.path,
          rel: path.basename(checked.path),
          format: formatOf(path.basename(checked.path))!,
          size,
        },
      ];
    }
  } catch (err) {
    return {
      error: `The office couldn’t read that folder: ${(err as Error).message}`,
    };
  }
  const skip = (rel: string, reason: string) => {
    scan.skippedCounts[reason] = (scan.skippedCounts[reason] ?? 0) + 1;
    if (scan.skipped.length < SKIP_LIST_MAX) scan.skipped.push({ path: rel, reason });
  };
  const c = new Collector();
  let bytes = 0;
  // CSS and token files first: they're where a design system is defined; HTML pages after.
  const order: SourceFormat[] = ['json', 'tailwind', 'scss', 'css', 'html'];
  found.sort((a, b) => order.indexOf(a.format) - order.indexOf(b.format) || a.rel.localeCompare(b.rel));
  for (const f of found) {
    if (scan.files.length >= caps.files || bytes + f.size > caps.bytes) {
      scan.truncated ??= `Read ${scan.files.length} files (${Math.round(bytes / 1024)} KB) and stopped there: the rest were left out`;
      skip(f.rel, 'over the cap');
      continue;
    }
    await turn();
    let buf: Buffer;
    try {
      // A file whose real path is outside the folder (a link inside it, a junction) is refused.
      const real = await realpath(f.abs);
      if (checked.kind === 'folder' && !inside(real, root)) {
        skip(f.rel, 'outside the folder (refused)');
        continue;
      }
      buf = await readFile(real);
    } catch {
      skip(f.rel, 'couldn’t be read');
      continue;
    }
    if (buf.subarray(0, 8192).includes(0)) {
      skip(f.rel, 'binary');
      continue;
    }
    bytes += buf.length;
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    let used = true;
    if (f.format === 'css' || f.format === 'scss') readCss(text, c.sink(f.rel, f.format), { scss: f.format === 'scss' });
    else if (f.format === 'html') {
      readHtml(text, f.rel, c);
      scan.notImported.layouts.push(f.rel);
      for (const m of text.matchAll(/<img\b[^>]*src\s*=\s*["']([^"']*(?:logo|brand)[^"']*)["']/gi)) if (scan.notImported.logos.length < 50) scan.notImported.logos.push(`${f.rel}: ${m[1].slice(0, 120)}`);
    } else if (f.format === 'json') used = readJson(text, f.rel, c);
    else if (f.format === 'tailwind') {
      const n = readTw(text, f.rel, c);
      used = n !== 0;
      if (n <= 0) skip(f.rel, 'no literal colours, fonts or radii (a config that computes them is never run)');
    }
    if (!used) {
      if (f.format === 'json') skip(f.rel, 'not design tokens');
      continue;
    }
    scan.files.push({
      path: f.rel,
      size: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
      format: f.format,
    });
  }
  scan.vars = c.finish().slice(0, 4000);
  scan.colours = [...c.colours.values()].sort((a, b) => b.count - a.count).slice(0, 400);
  scan.fonts = [...c.fonts.values()].slice(0, 100);
  scan.radii = [...c.radii.values()].slice(0, 100);
  scan.heights = [...c.heights.values()].slice(0, 100);
  scan.darkHow = [...c.darkHow].slice(0, 20);
  scan.remote = c.remote;
  scan.notImported.fonts = [...scan.notImported.fonts.slice(0, 50), ...[...c.fontFaces].slice(0, 20)];
  scan.notImported.logos = scan.notImported.logos.slice(0, 50);
  scan.notImported.layouts = scan.notImported.layouts.slice(0, 50);
  if (!scan.files.length)
    return {
      error: 'No design files there: the office reads .css, .scss, .html, design-token .json and tailwind.config.* (dependencies, build output and secrets-like files are left out)',
    };
  return scan;
}
