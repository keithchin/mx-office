// The docs page's parts (docs.ts puts them together): the sidebar's tree, the page with its
// breadcrumbs, title, intro and last-changed day, a section's list of its pages, the "On this page"
// list, the previous / next links, the search results page and the page for an address that isn't
// there. The page HTML comes from the build (server/docsite.ts), which made it from our own Markdown.
import { h } from '../ui/dom';
import { docUrl, readingOrder, searchDocs, searchTerms, trail, type DocBundle, type DocPage, type NavNode, type SearchHit } from '../../shared/docsite';

/** Which sidebar sections are open, kept in this browser. */
const OPEN_KEY = 'agent-office.docs-open';

function openSections(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function keepOpen(set: Set<string>) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...set]));
  } catch {
    // Just for this visit.
  }
}

/** The day as "5 October 2026". */
export const longDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
};

/** The sidebar: every section, the one the page is in open and the page marked. */
export function renderSide(side: HTMLElement, bundle: DocBundle, slug: string) {
  const open = openSections();
  const path = new Set(trail(bundle.nav, slug).map((n) => n.slug));
  const item = (n: NavNode, depth: number): HTMLElement => {
    const here = n.slug === slug;
    const link = h('a.dx-nav-link', { href: docUrl(n.slug), ...(here ? { 'aria-current': 'page' } : {}) }, n.title, n.badge ? h('span.dx-badge', {}, n.badge) : null);
    if (!n.children.length) return h('li', { class: here ? 'on' : '' }, link);
    const isOpen = path.has(n.slug) || open.has(n.slug);
    const toggle = h('button.dx-nav-toggle', { type: 'button', 'aria-label': `${isOpen ? 'Close' : 'Open'} ${n.title}`, 'aria-expanded': String(isOpen) }, '›');
    const list = h('ul', { class: `dx-nav-list depth-${depth + 1}` }, ...n.children.map((c) => item(c, depth + 1)));
    const li = h('li', { class: `dx-nav-sec${isOpen ? ' open' : ''}${here ? ' on' : ''}` }, h('div.dx-nav-row', {}, link, toggle), list);
    toggle.addEventListener('click', () => {
      const now = !li.classList.contains('open');
      li.classList.toggle('open', now);
      toggle.setAttribute('aria-expanded', String(now));
      toggle.setAttribute('aria-label', `${now ? 'Close' : 'Open'} ${n.title}`);
      if (now) open.add(n.slug);
      else open.delete(n.slug);
      keepOpen(open);
    });
    return li;
  };
  side.replaceChildren(
    h('nav', { 'aria-label': 'Sections' }, h('a', { class: `dx-nav-home${slug === '' ? ' on' : ''}`, href: '/docs', ...(slug === '' ? { 'aria-current': 'page' } : {}) }, '📚 Documentation home'), h('ul.dx-nav-list.depth-0', {}, ...bundle.nav.map((n) => item(n, 0)))),
  );
  side.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
}

function crumbs(bundle: DocBundle, slug: string, last?: string): HTMLElement {
  const t = trail(bundle.nav, slug);
  const parts: HTMLElement[] = [h('a', { href: '/docs' }, 'Docs')];
  t.forEach((n, i) => parts.push(i === t.length - 1 && !last ? h('span', { 'aria-current': 'page' }, n.title) : h('a', { href: docUrl(n.slug) }, n.title)));
  if (last) parts.push(h('span', { 'aria-current': 'page' }, last));
  const ol = h('ol.dx-crumbs');
  for (const p of parts) ol.append(h('li', {}, p));
  return h('nav', { 'aria-label': 'Breadcrumbs' }, ol);
}

function prevNext(bundle: DocBundle, slug: string): HTMLElement | null {
  const order = readingOrder(bundle.nav);
  const i = order.indexOf(slug);
  if (i < 0) return null;
  const at = (j: number) => (j >= 0 && j < order.length ? bundle.pages.find((p) => p.slug === order[j]) : undefined);
  const card = (p: DocPage | undefined, dir: 'prev' | 'next') =>
    p ? h('a', { class: `dx-pn dx-pn-${dir}`, href: docUrl(p.slug), rel: dir }, h('span.dx-pn-dir', {}, dir === 'prev' ? '‹ Previous' : 'Next ›'), h('span.dx-pn-title', {}, p.title || 'Documentation home')) : h('span');
  return h('nav.dx-prevnext', { 'aria-label': 'Previous and next page' }, card(at(i - 1), 'prev'), card(at(i + 1), 'next'));
}

/** A section's pages, each with its description: what a section page lists under its own text. */
function childList(bundle: DocBundle, slug: string): HTMLElement | null {
  const node = slug ? trail(bundle.nav, slug).at(-1) : undefined;
  const kids = slug ? node?.children ?? [] : bundle.nav;
  if (!kids.length) return null;
  return h(
    'div.dx-cards',
    {},
    ...kids.map((k) => {
      const p = bundle.pages.find((x) => x.slug === k.slug);
      return h('a.dx-card', { href: docUrl(k.slug) }, h('span.dx-card-title', {}, k.title, k.badge ? h('span.dx-badge', {}, k.badge) : null), p?.description ? h('span.dx-card-desc', {}, p.description) : null);
    }),
  );
}

/** The "On this page" list on the right, for the scrollspy to mark. */
export function renderToc(toc: HTMLElement, page: DocPage | undefined) {
  const heads = page?.headings ?? [];
  if (heads.length < 2) return toc.replaceChildren();
  toc.replaceChildren(
    h('p.dx-toc-h', {}, 'On this page'),
    h('ul', {}, ...heads.map((x) => h('li', { class: `d${x.depth}` }, h('a', { href: `#${x.id}`, 'data-id': x.id }, x.text)))),
  );
}

/** A page of the docs, whole. */
export function renderPage(main: HTMLElement, bundle: DocBundle, page: DocPage) {
  const body = h('div.dx-body');
  body.innerHTML = page.html;
  // The title is the front matter's; a page's own top heading would say it twice.
  body.querySelector(':scope > h1:first-child')?.remove();
  const home = page.slug === '';
  main.replaceChildren(
    h(
      'article.dx-article',
      {},
      home ? null : crumbs(bundle, page.slug),
      h('h1.dx-title', {}, page.title, page.badge ? h('span.dx-badge.big', {}, page.badge) : null),
      page.description ? h('p.dx-lead', {}, page.description) : null,
      h('p.dx-updated', {}, `Last updated: ${longDate(page.updated)}`),
      body,
      childList(bundle, page.slug),
      prevNext(bundle, page.slug),
      h('footer.dx-foot', {}, 'Source: ', h('code', {}, `docs/site/${page.file}`), ' · Built ', longDate(bundle.built)),
    ),
  );
}

/** Marks the query's words in `text`. */
function marked(text: string, terms: string[]): (string | HTMLElement)[] {
  if (!terms.length) return [text];
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? h('mark', {}, part) : part));
}

/** Where a hit is in the docs, as "Section › Page". */
export const hitPlace = (bundle: DocBundle, hit: SearchHit) =>
  trail(bundle.nav, hit.slug)
    .slice(0, -1)
    .map((n) => n.title)
    .join(' › ') || 'Docs';

/** One search result, as a link. */
export function hitLink(bundle: DocBundle, hit: SearchHit, q: string, cls = 'dx-hit'): HTMLAnchorElement {
  const terms = searchTerms(q);
  return h(
    'a',
    { class: cls, href: docUrl(hit.slug, hit.heading?.id) },
    h('span.dx-hit-place', {}, hitPlace(bundle, hit)),
    h('span.dx-hit-title', {}, ...marked(hit.title, terms), hit.heading ? h('span.dx-hit-head', {}, ' › ', ...marked(hit.heading.text, terms)) : null),
    h('span.dx-hit-snip', {}, ...marked(hit.snippet, terms)),
  );
}

/** The search results page, /docs/search?q=… */
export function renderSearch(main: HTMLElement, bundle: DocBundle, q: string) {
  const hits = searchDocs(bundle.pages, q, 50);
  main.replaceChildren(
    h(
      'article.dx-article',
      {},
      crumbs(bundle, '', 'Search'),
      h('h1.dx-title', {}, q ? `Search results for “${q}”` : 'Search the docs'),
      h('p.dx-lead', {}, q ? `${hits.length} ${hits.length === 1 ? 'page' : 'pages'} found.` : 'Type in the search box at the top. Press / anywhere to jump there.'),
      hits.length ? h('div.dx-hits', {}, ...hits.map((x) => hitLink(bundle, x, q))) : q ? h('div.dx-alert.dx-alert-tip', {}, h('p.dx-alert-title', {}, 'Tip'), h('p', {}, 'Try fewer or shorter words, or look in the ', h('a', { href: '/docs/faq' }, 'FAQ'), ' and the ', h('a', { href: '/docs/reference/glossary' }, 'Glossary'), '.')) : null,
    ),
  );
}

/** The page for an address under /docs that isn't one. */
export function renderMissing(main: HTMLElement, bundle: DocBundle, slug: string) {
  const guess = searchDocs(bundle.pages, slug.replace(/[/-]+/g, ' '), 5);
  main.replaceChildren(
    h(
      'article.dx-article',
      {},
      crumbs(bundle, '', 'Not found'),
      h('h1.dx-title', {}, 'Page not found'),
      h('p.dx-lead', {}, 'There is no page at ', h('code', {}, docUrl(slug)), '. It may have moved, or the link has a typo.'),
      guess.length ? h('h2', {}, 'Maybe one of these?') : null,
      guess.length ? h('div.dx-hits', {}, ...guess.map((x) => hitLink(bundle, x, ''))) : null,
      h('p', {}, h('a', { href: '/docs' }, '← Back to the documentation home')),
    ),
  );
}
