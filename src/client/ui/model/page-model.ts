// A page, snippet or layout as the Page view draws it (page-view.ts): its header (title, layout, URL,
// parameters, folder), the roles that may open it, and its widget tree, read from its MDL (mdl-tree.ts).
// Worked out only when the Page view is on screen, and kept by the MDL's text (the server keeps that by
// the page's content hash), so going back to a page or switching Page ⇄ MDL reads nothing again.
// Pure (no DOM).

import { parseMdl, type MdlItem } from './mdl-tree';

export interface PageModel {
  /** page, snippet, layout, buildingblock, … (the word after `create or modify`). */
  kind: string;
  name: string;
  folder?: string;
  title?: string;
  layout?: string;
  url?: string;
  params?: string;
  /** Layouts: their type (Responsive, Phone, …). */
  layoutType?: string;
  /** Module roles allowed to open it (`grant view on page … to …`). */
  roles: string[];
  widgets: MdlItem[];
}

const KEEP = 40;
const kept = new Map<string, PageModel | null>();
/** How many times an MDL text was read (tests check pages aren't read twice, or before they're shown). */
export const pageStats = { parses: 0 };

function read(mdl: string): PageModel | null {
  pageStats.parses++;
  const statements = parseMdl(mdl);
  const create = statements.find((s) => s.words[0]?.toLowerCase() === 'create');
  if (!create) return null;
  const w = create.words.map((x) => x.toLowerCase());
  let at = w[1] === 'or' ? 3 : 1;
  const kind = w[at] === 'building' ? 'buildingblock' : w[at] ?? 'page';
  if (w[at] === 'building') at++;
  const name = create.words[at + 1] ?? '';
  const fi = w.indexOf('folder', at + 2);
  const p = create.props;
  const model: PageModel = { kind, name, roles: [], widgets: create.children };
  if (fi > 0 && create.words[fi + 1]) model.folder = create.words[fi + 1];
  if (p.Title) model.title = p.Title;
  if (p.Layout) model.layout = p.Layout;
  if (p.Url) model.url = p.Url;
  if (p.Params) model.params = p.Params.replace(/^\(\s*|\s*\)$/g, '');
  const lt = p.layouttype ?? p.LayoutType;
  if (lt) model.layoutType = lt;
  for (const s of statements) {
    const g = s.words.map((x) => x.toLowerCase());
    if (g[0] !== 'grant') continue;
    const to = g.indexOf('to');
    if (to > 0) model.roles.push(...s.words.slice(to + 1));
  }
  return model;
}

/** The page in `mdl` (null when it isn't one), read once per text. */
export function pageModel(mdl: string): PageModel | null {
  if (kept.has(mdl)) {
    const m = kept.get(mdl) ?? null;
    kept.delete(mdl);
    kept.set(mdl, m);
    return m;
  }
  const m = read(mdl);
  kept.set(mdl, m);
  while (kept.size > KEEP) kept.delete(kept.keys().next().value as string);
  return m;
}

/** `Content: '{1} - {2}'` with `ContentParams: ({1} = StartDate format (…), {2} = EndDate …)` → `{StartDate} - {EndDate}`. */
export function textOf(it: MdlItem): string {
  const content = it.props.Content ?? it.props.Caption ?? it.props.Text ?? '';
  const params = new Map<string, string>();
  for (const m of (it.props.ContentParams ?? it.props.CaptionParams ?? '').matchAll(/\{(\d+)\}\s*=\s*([$\w./]+)/g)) params.set(m[1], m[2]);
  return content.replace(/\{(\d+)\}/g, (all, n: string) => {
    const v = params.get(n);
    return v ? `{${v.slice(v.lastIndexOf('/') + 1)}}` : all;
  });
}

/** What a data widget shows: `DataSource: microflow M.DS_X` → `microflow DS_X`, `database from M.E where …` → `database M.E`. */
export function sourceOf(it: MdlItem): string {
  const ds = it.props.DataSource ?? '';
  if (!ds) return 'context';
  let m = /^(microflow|nanoflow)\s+([\w.]+)/i.exec(ds);
  if (m) return `${m[1].toLowerCase()} ${m[2]}`;
  m = /^database\s+(?:from\s+)?([\w.]+)/i.exec(ds);
  if (m) return `database ${m[1]}${/\bwhere\b/i.test(ds) ? ' [XPath]' : ''}`;
  m = /^association\s+([\w./]+)/i.exec(ds);
  if (m) return `over ${m[1]}`;
  return ds.length > 60 ? `${ds.slice(0, 57)}…` : ds;
}
