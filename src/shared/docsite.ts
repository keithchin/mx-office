// The documentation site (/docs): its pages' front matter, the navigation tree, the order the pages
// read in (prev / next), links between them, and the search over them. The pages are Markdown under
// docs/site/ (front matter: title, description, weight, aliases); the build turns them into one
// bundle (server/docsite.ts, called from vite.config.ts) and the docs page (client/docs.ts) reads it.
// Pure code, no DOM or Node, so the build, the page and the tests all follow the same rules.

/** A page's front matter: what the sidebar, the search and the page's head show. */
export interface DocMeta {
  title: string;
  description?: string;
  /** Lower comes first among its siblings; equal weights go by title. */
  weight?: number;
  /** Older addresses (`/docs/…` or a bare slug) that land on this page. */
  aliases?: string[];
  /** A word or two by its title in the sidebar, e.g. "Preview". */
  badge?: string;
}

/** One heading on a page, for its "On this page" list and the search. */
export interface DocHeading {
  id: string;
  text: string;
  depth: number;
}

/** One page in the bundle. `slug` is its address under /docs ('' is the docs home). */
export interface DocPage extends DocMeta {
  slug: string;
  /** The Markdown file, from docs/site/. */
  file: string;
  html: string;
  headings: DocHeading[];
  /** The page's words, for the search. */
  text: string;
  /** The day it last changed (YYYY-MM-DD). */
  updated: string;
}

/** A node of the sidebar: a page, with the pages under it when it's a section. */
export interface NavNode {
  slug: string;
  title: string;
  badge?: string;
  children: NavNode[];
}

/** What the build writes and the docs page reads. */
export interface DocBundle {
  built: string;
  pages: DocPage[];
  nav: NavNode[];
}

// ---- Front matter -----------------------------------------------------------------------------------

const unquote = (s: string) => {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/**
 * Splits `---` front matter off a Markdown file. Only what the pages use: `key: value`, numbers,
 * `[a, b]` lists and `- item` lists under a key. Anything else in it is kept as a string.
 */
export function parseFrontMatter(src: string): { data: Record<string, string | number | string[]>; body: string } {
  const text = src.replace(/^﻿/, '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | number | string[]> = {};
  let listKey: string | undefined;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    const v = raw.trim();
    listKey = undefined;
    if (!v) {
      data[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(v)) {
      data[key] = v.slice(1, -1).split(',').map(unquote).filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(v)) {
      data[key] = Number(v);
    } else {
      data[key] = unquote(v);
    }
  }
  return { data, body: text.slice(m[0].length) };
}

/** The page's meta from its front matter, its title falling back to `fallback`. */
export function docMeta(data: Record<string, string | number | string[]>, fallback: string): DocMeta {
  const str = (k: string) => (typeof data[k] === 'string' && data[k] ? (data[k] as string) : undefined);
  const aliases = Array.isArray(data.aliases) ? data.aliases : typeof data.aliases === 'string' ? [data.aliases] : undefined;
  return {
    title: str('title') ?? fallback,
    description: str('description'),
    weight: typeof data.weight === 'number' ? data.weight : undefined,
    aliases: aliases?.length ? aliases : undefined,
    badge: str('badge'),
  };
}

// ---- Addresses --------------------------------------------------------------------------------------

/** A heading's anchor: lower case, words joined by dashes, as GitHub makes them. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/** A file under docs/site/ to its page's slug: `a/b.md` is `a/b`, `a/_index.md` is `a`, `_index.md` is ''. */
export function fileToSlug(file: string): string {
  const f = file.replace(/\\/g, '/').replace(/\.md$/i, '');
  if (f === '_index') return '';
  return f.replace(/\/_index$/, '');
}

/** The address of the page with `slug`. */
export const docUrl = (slug: string, hash?: string) => `/docs${slug ? `/${slug}` : ''}${hash ? `#${hash}` : ''}`;

/** The slug an address under /docs asks for ('' for /docs itself), or undefined for anything else. */
export function slugFromPath(p: string): string | undefined {
  const m = /^\/docs(?:\/(.*?))?\/?$/.exec(p);
  if (!m) return undefined;
  return (m[1] ?? '').replace(/\.html?$/, '');
}

const normalize = (parts: string[]) => {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
};

/**
 * Where a link in the page from `file` goes, inside the docs: a relative `.md` link (as GitHub
 * follows it too) or a `/docs/…` one, to `{ slug, hash }`; undefined for one that leaves the docs.
 */
export function resolveDocHref(file: string, href: string): { slug: string; hash?: string } | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const [pathPart, hash] = href.split('#', 2) as [string, string | undefined];
  if (!pathPart) return { slug: fileToSlug(file), hash };
  if (pathPart.startsWith('/docs')) {
    const slug = slugFromPath(pathPart);
    return slug === undefined ? undefined : { slug, hash };
  }
  if (pathPart.startsWith('/') || !/\.md$/i.test(pathPart)) return undefined;
  const dir = file.replace(/\\/g, '/').split('/').slice(0, -1);
  return { slug: fileToSlug(normalize([...dir, ...pathPart.split('/')])), hash };
}

/** Where an image in the page from `file` is served: docs/site/images/x.png is /docs/images/x.png. */
export function resolveDocImage(file: string, src: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) return undefined;
  const dir = file.replace(/\\/g, '/').split('/').slice(0, -1);
  const rel = normalize([...dir, ...src.split('/')]);
  return rel.startsWith('images/') ? `/docs/${rel}` : undefined;
}

// ---- The navigation tree and the reading order ------------------------------------------------------

const byWeight = (a: DocMeta & { slug: string }, b: DocMeta & { slug: string }) =>
  (a.weight ?? 1000) - (b.weight ?? 1000) || a.title.localeCompare(b.title);

/** The sidebar: every page under the section it's in (its folder's `_index.md`), in weight order. */
export function buildNav(pages: readonly Pick<DocPage, 'slug' | 'title' | 'weight' | 'badge'>[]): NavNode[] {
  const nodes = new Map<string, NavNode & { weight?: number }>();
  for (const p of pages) if (p.slug) nodes.set(p.slug, { slug: p.slug, title: p.title, badge: p.badge, weight: p.weight, children: [] });
  const roots: (NavNode & { weight?: number })[] = [];
  for (const n of nodes.values()) {
    const parent = n.slug.split('/').slice(0, -1).join('/');
    const up = parent ? nodes.get(parent) : undefined;
    (up ? up.children : roots).push(n);
  }
  const sort = (list: (NavNode & { weight?: number })[]): NavNode[] =>
    list.sort(byWeight).map(({ slug, title, badge, children }) => ({ slug, title, ...(badge ? { badge } : {}), children: sort(children) }));
  return sort(roots);
}

/** Every page in reading order: the docs home, then the sidebar from top to bottom. */
export function readingOrder(nav: readonly NavNode[]): string[] {
  const out = [''];
  const walk = (list: readonly NavNode[]) => list.forEach((n) => (out.push(n.slug), walk(n.children)));
  walk(nav);
  return out;
}

/** The sections from the top down to the page, for its breadcrumbs (the page itself last). */
export function trail(nav: readonly NavNode[], slug: string): NavNode[] {
  const find = (list: readonly NavNode[], path: NavNode[]): NavNode[] | undefined => {
    for (const n of list) {
      if (n.slug === slug) return [...path, n];
      const deeper = find(n.children, [...path, n]);
      if (deeper) return deeper;
    }
    return undefined;
  };
  return find(nav, []) ?? [];
}

/** The page an address lands on: the slug itself, or the page with it as an alias. */
export function findPage(bundle: Pick<DocBundle, 'pages'>, slug: string): DocPage | undefined {
  const s = slug.replace(/^\/+|\/+$/g, '');
  return (
    bundle.pages.find((p) => p.slug === s) ??
    bundle.pages.find((p) => p.aliases?.some((a) => (slugFromPath(a) ?? a.replace(/^\/+|\/+$/g, '')) === s))
  );
}

// ---- Search -----------------------------------------------------------------------------------------

export interface SearchHit {
  slug: string;
  title: string;
  /** The heading the best match is under, to jump straight to it. */
  heading?: DocHeading;
  snippet: string;
  score: number;
}

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^\p{L}\p{N}._-]+/u)
    .map((w) => w.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((w) => w.length > 1 || /\d/.test(w));

const count = (hay: string, w: string) => {
  let n = 0;
  for (let i = hay.indexOf(w); i !== -1 && n < 50; i = hay.indexOf(w, i + w.length)) n++;
  return n;
};

/** A bit of `text` around the first word found, at most `len` characters. */
export function snippetFor(text: string, terms: readonly string[], len = 160): string {
  const low = text.toLowerCase();
  const at = terms.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - Math.floor(len / 3));
  const cut = text.slice(start, start + len).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${cut}${start + len < text.length ? '…' : ''}`;
}

/**
 * The pages that match every word of `query`, best first: a word in the title counts most, then in
 * a heading or the description, then in the text. A word matches the start of a longer one too.
 */
export function searchDocs(pages: readonly DocPage[], query: string, limit = 20): SearchHit[] {
  const terms = words(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const p of pages) {
    const title = p.title.toLowerCase();
    const desc = (p.description ?? '').toLowerCase();
    const body = p.text.toLowerCase();
    let score = 0;
    let all = true;
    let best: { h: DocHeading; n: number } | undefined;
    for (const t of terms) {
      const inTitle = count(title, t);
      const inDesc = count(desc, t);
      const inBody = count(body, t);
      let inHeads = 0;
      for (const h of p.headings) {
        const n = count(h.text.toLowerCase(), t);
        inHeads += n;
        if (n && (!best || n > best.n)) best = { h, n };
      }
      if (!inTitle && !inDesc && !inBody && !inHeads) {
        all = false;
        break;
      }
      score += inTitle * 20 + (title === t ? 30 : 0) + inHeads * 6 + inDesc * 4 + Math.min(inBody, 10);
    }
    if (!all) continue;
    if (title.includes(query.trim().toLowerCase())) score += 15;
    hits.push({ slug: p.slug, title: p.title, heading: best?.h, snippet: snippetFor(p.text, terms), score });
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

/** The query's words, for marking them in the results. */
export const searchTerms = words;
