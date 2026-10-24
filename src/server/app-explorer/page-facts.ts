// What the Model preview asks about one page at one revision (shared/page-facts.ts): its widgets' $Type and $ID
// (the page, its layout and the snippets they call, from the units' BSON), the pages that share each of those
// snippets, and the project's layout classes from its theme (./theme.ts). All read from git at that commit: no
// mxcli, no runtime. Kept per commit (a commit never changes); a failure isn't kept.

import { modelOf } from '../model/index.js';
import type { Floor } from '../floor.js';
import { blobOnBranch } from '../deliverables/git.js';
import { filesIndex } from './files.js';
import { SKIP_MODULE, themeCss, THEME_MAX_BYTES } from './theme.js';
import type { PageFacts } from '../../shared/page-facts.js';

type Ctx = { cfg: { dataDir: string } };
type Bson = Record<string, unknown>;

/** What a commit's pages, layouts and snippets call: kept per commit. */
interface Calls {
  /** doc key (`page:M.P`, `layout:M.L`, `snippet:M.S`) → snippet qns it calls directly. */
  snippets: Map<string, string[]>;
  /** page qn → its layout qn. */
  layout: Map<string, string>;
}

const QN = /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/;
const callsKept = new Map<string, Promise<Calls>>();
const themeKept = new Map<string, Promise<PageFacts['theme']>>();
const KEEP = 6;
const keep = <T>(m: Map<string, Promise<T>>, key: string, p: Promise<T>) => {
  m.set(key, p);
  p.catch(() => m.delete(key));
  while (m.size > KEEP) m.delete(m.keys().next().value as string);
  return p;
};

/** Every named widget under a document (its own Name excepted): name → [$Type, $ID]. */
export function widgetsOf(doc: unknown): Record<string, [string, string]> {
  const out: Record<string, [string, string]> = {};
  const walk = (n: unknown, top: boolean) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, false));
    const o = n as Bson;
    if (!top && typeof o.Name === 'string' && o.Name && typeof o.$Type === 'string' && !(o.Name in out)) out[o.Name] = [o.$Type, typeof o.$ID === 'string' ? o.$ID : ''];
    for (const [k, v] of Object.entries(o)) if (k !== '$ID' && v && typeof v === 'object') walk(v, false);
  };
  walk(doc, true);
  return out;
}

/** The snippets a document calls directly, and (a page) its layout. */
export function callsOf(doc: unknown): { snippets: string[]; layout?: string } {
  const snippets = new Set<string>();
  let layout: string | undefined;
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const o = n as Bson;
    if (o.$Type === 'Forms$SnippetCall' && typeof o.Form === 'string' && QN.test(o.Form)) snippets.add(o.Form);
    if (o.$Type === 'Forms$LayoutCall' && typeof o.Form === 'string' && QN.test(o.Form)) layout ??= o.Form;
    for (const [k, v] of Object.entries(o)) if (k !== '$ID' && v && typeof v === 'object') walk(v);
  };
  walk(doc);
  return { snippets: [...snippets], ...(layout ? { layout } : {}) };
}

async function callsAt(ix: { byName: Map<string, string>; read(id: string): Promise<unknown> }, key: string): Promise<Calls> {
  const hit = callsKept.get(key);
  if (hit) return hit;
  return keep(
    callsKept,
    key,
    (async () => {
      const calls: Calls = { snippets: new Map(), layout: new Map() };
      for (const [k, id] of ix.byName) {
        if (!/^(page|layout|snippet):/.test(k)) continue;
        const doc = await ix.read(id).catch(() => null);
        if (!doc) continue;
        const c = callsOf(doc);
        if (c.snippets.length) calls.snippets.set(k, c.snippets);
        if (k.startsWith('page:') && c.layout) calls.layout.set(k.slice(5), c.layout);
      }
      return calls;
    })(),
  );
}

/** The snippets a document shows, through nested snippet calls too (to depth 4). */
function snippetsUnder(calls: Calls, key: string, into = new Set<string>(), depth = 0): Set<string> {
  if (depth > 4) return into;
  for (const s of calls.snippets.get(key) ?? []) {
    if (into.has(s)) continue;
    into.add(s);
    snippetsUnder(calls, `snippet:${s}`, into, depth + 1);
  }
  return into;
}

/** The project's layout classes from its own modules' themes at `sha` (Atlas and Marketplace skipped). */
function themeAt(dir: string, sha: string): Promise<PageFacts['theme']> {
  const key = `${dir}\0${sha}`;
  const hit = themeKept.get(key);
  if (hit) return hit;
  return keep(
    themeKept,
    key,
    (async () => {
      const idx = await filesIndex(dir, sha);
      const paths = [...idx.files.keys()].filter((p) => {
        const m = /^themesource\/([^/]+)\/web\/main\.scss$/.exec(p);
        return m && !SKIP_MODULE.test(m[1]) && (idx.files.get(p)?.size ?? 0) <= THEME_MAX_BYTES;
      });
      const tokenPaths = ['theme/web/custom-variables.scss'].filter((p) => idx.files.has(p));
      const read = async (p: string) => ({ path: p, text: (await blobOnBranch(dir, sha, p, THEME_MAX_BYTES))?.toString('utf8') ?? '' });
      const files = await Promise.all(paths.slice(0, 8).map(read));
      const tokens = await Promise.all(tokenPaths.map(read));
      return { css: themeCss(files, tokens.map((t) => t.text)), from: files.filter((f) => f.text).map((f) => f.path) };
    })(),
  );
}

/** The page's facts at `sha`, or why not. */
export async function pageFacts(ctx: Ctx, floor: Floor, sha: string, qn: string): Promise<PageFacts | { status: number; error: string }> {
  if (!QN.test(qn)) return { status: 400, error: 'Which page? (a qualified name)' };
  const theme = await themeAt(floor.dir, sha).catch(() => ({ css: '', from: [] }));
  const cm = await modelOf(ctx).units.commit(floor.dir, sha).catch((err: Error) => err);
  if (cm instanceof Error || !cm) return { rev: sha, qn, widgets: {}, usedOn: {}, theme, problem: `The model couldn’t be read at this revision${cm instanceof Error ? `: ${cm.message}` : ''}` };
  const ix = cm.ix;
  const pageId = ix.byName.get(`page:${qn}`);
  if (!pageId) return { status: 404, error: 'No such page at this revision' };
  const calls = await callsAt(ix, `${floor.dir}\0${sha}`);
  const layout = calls.layout.get(qn);
  const snippets = snippetsUnder(calls, `page:${qn}`);
  if (layout) snippetsUnder(calls, `layout:${layout}`, snippets);
  const widgets: PageFacts['widgets'] = {};
  const read = async (key: string, docQn: string) => {
    const id = ix.byName.get(key);
    const doc = id ? await ix.read(id).catch(() => null) : null;
    if (doc) widgets[docQn] = widgetsOf(doc);
  };
  await read(`page:${qn}`, qn);
  if (layout) await read(`layout:${layout}`, layout);
  for (const s of snippets) await read(`snippet:${s}`, s);
  // Who else shows each snippet: pages calling it (or a snippet that does), and pages whose layout does.
  const usedOn: PageFacts['usedOn'] = {};
  if (snippets.size) {
    const shows = new Map<string, Set<string>>();
    const under = (key: string) => snippetsUnder(calls, key);
    const layouts = new Map<string, Set<string>>();
    for (const [page, lay] of calls.layout) {
      if (!layouts.has(lay)) layouts.set(lay, under(`layout:${lay}`));
      for (const s of [...under(`page:${page}`), ...(layouts.get(lay) ?? [])]) if (snippets.has(s)) (shows.get(s) ?? shows.set(s, new Set()).get(s)!).add(page);
    }
    for (const k of ix.byName.keys()) {
      if (!k.startsWith('page:') || calls.layout.has(k.slice(5))) continue;
      for (const s of under(k)) if (snippets.has(s)) (shows.get(s) ?? shows.set(s, new Set()).get(s)!).add(k.slice(5));
    }
    for (const [s, pages] of shows) usedOn[s] = [...pages].sort();
  }
  return { rev: sha, qn, widgets, usedOn, theme };
}
