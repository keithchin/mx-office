// The documentation site (/docs): the office's manual, in the layout of docs.mendix.com. The pages are
// Markdown in docs/site/, built into one bundle (docs/site.json, see server/docsite.ts) that this page
// fetches once; from then on every page, the sidebar, the "On this page" list and the search are drawn
// here without going back to the server. Addresses are /docs/<section>/<page>#<heading>, so any of
// them can be bookmarked or linked from the office; /docs/search?q= is the full search.
// It isn't in the office over the socket (nothing on it is live), and it loads no three.js.

import { $, h } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { docUrl, findPage, searchDocs, slugFromPath, type DocBundle } from '../shared/docsite';
import { hitLink, renderMissing, renderPage, renderSearch, renderSide, renderToc } from './docs/layout';
import { watchToc } from './docs/toc';
import './docs/docs.css';

const side = $('dx-side');
const main = $('dx-main');
const toc = $('dx-toc');
const q = $('dx-q') as HTMLInputElement;
const results = $('dx-results');
const scrim = $('dx-scrim');
const navToggle = $('dx-nav-toggle');

colorThemes($('dx-theme'));

let bundle: DocBundle | undefined;
let stopToc = () => {};

// ---- Drawing the address ----------------------------------------------------------------------------
function show(scrollTo: 'top' | 'hash' | 'keep' = 'hash') {
  if (!bundle) return;
  const slug = slugFromPath(location.pathname) ?? '';
  stopToc();
  closeDrawer();
  if (slug === 'search') {
    const query = new URLSearchParams(location.search).get('q') ?? '';
    renderSearch(main, bundle, query);
    renderSide(side, bundle, '');
    renderToc(toc, undefined);
    document.title = `Search · Docs · Agent Office`;
  } else {
    const page = findPage(bundle, slug);
    if (page && page.slug !== slug) {
      // An alias, or a trailing slash: the page's own address.
      history.replaceState(null, '', docUrl(page.slug, location.hash.slice(1) || undefined));
    }
    if (page) {
      renderPage(main, bundle, page);
      renderSide(side, bundle, page.slug);
      renderToc(toc, page);
      stopToc = watchToc(main, toc);
      document.title = `${page.slug ? `${page.title} · ` : ''}Docs · Agent Office`;
    } else {
      renderMissing(main, bundle, slug);
      renderSide(side, bundle, '');
      renderToc(toc, undefined);
      document.title = 'Not found · Docs · Agent Office';
    }
  }
  const target = scrollTo === 'hash' && location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
  if (target) target.scrollIntoView();
  else if (scrollTo !== 'keep') window.scrollTo({ top: 0 });
}

/** Goes to `href` inside the docs without loading the page again. */
function go(href: string) {
  const url = new URL(href, location.href);
  const samePage = url.pathname === location.pathname && url.search === location.search;
  history.pushState(null, '', url.pathname + url.search + url.hash);
  if (samePage && url.hash) {
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  show(url.hash ? 'hash' : 'top');
  main.focus({ preventScroll: true });
}

addEventListener('popstate', () => show('hash'));

// Links to other pages of the docs stay on this page; the rest (the office, GitHub) go as usual.
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.('a');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || slugFromPath(url.pathname) === undefined || url.pathname.startsWith('/docs/images/')) return;
  e.preventDefault();
  hideResults();
  go(url.href);
});

// ---- Copy buttons on the code, and pictures bigger ----------------------------------------------------
main.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest('.dh-copy');
  if (btn) {
    const code = btn.parentElement?.querySelector('code')?.textContent ?? '';
    void navigator.clipboard?.writeText(code).then(
      () => flash(btn, 'Copied ✓'),
      () => flash(btn, 'Select and copy'),
    );
    return;
  }
  const img = (e.target as Element).closest('.dh-figure img') as HTMLImageElement | null;
  if (img) openPicture(img);
});

function flash(btn: Element, text: string) {
  btn.textContent = text;
  setTimeout(() => (btn.textContent = 'Copy'), 1500);
}

function openPicture(img: HTMLImageElement) {
  const close = h('button.dx-lb-close', { type: 'button', 'aria-label': 'Close' }, '✕');
  const box = h('div.dx-lightbox', { role: 'dialog', 'aria-label': img.alt || 'Picture' }, h('img', { src: img.src, alt: img.alt }), img.alt ? h('p', {}, img.alt) : null, close);
  const done = () => (box.remove(), removeEventListener('keydown', onKey));
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && done();
  box.addEventListener('click', done);
  addEventListener('keydown', onKey);
  document.body.append(box);
  close.focus();
}

// ---- The drawer (the sidebar on a narrow screen) ----------------------------------------------------
function closeDrawer() {
  document.body.classList.remove('dx-drawer');
  scrim.classList.add('hidden');
  navToggle.setAttribute('aria-expanded', 'false');
}
navToggle.addEventListener('click', () => {
  const open = !document.body.classList.contains('dx-drawer');
  document.body.classList.toggle('dx-drawer', open);
  scrim.classList.toggle('hidden', !open);
  navToggle.setAttribute('aria-expanded', String(open));
});
scrim.addEventListener('click', closeDrawer);

// ---- The search box ---------------------------------------------------------------------------------
let picked = -1;
function hideResults() {
  results.classList.add('hidden');
  picked = -1;
}
function runSearch() {
  if (!bundle) return;
  const text = q.value.trim();
  if (!text) return hideResults();
  const hits = searchDocs(bundle.pages, text, 8);
  picked = -1;
  results.replaceChildren(
    ...(hits.length ? hits.map((x) => hitLink(bundle!, x, text, 'dx-hit dx-hit-mini')) : [h('p.dx-none', {}, `Nothing found for “${text}”.`)]),
    h('a.dx-all', { href: `/docs/search?q=${encodeURIComponent(text)}` }, 'See all results ↵'),
  );
  results.classList.remove('hidden');
}
q.addEventListener('input', runSearch);
q.addEventListener('focus', () => q.value.trim() && runSearch());
q.addEventListener('keydown', (e) => {
  const items = [...results.querySelectorAll<HTMLAnchorElement>('a')];
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!items.length) return;
    picked = (picked + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items.forEach((a, i) => a.classList.toggle('on', i === picked));
    items[picked].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const a = items[picked];
    hideResults();
    q.blur();
    go(a ? a.href : `/docs/search?q=${encodeURIComponent(q.value.trim())}`);
  } else if (e.key === 'Escape') {
    hideResults();
    q.blur();
  }
});
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest?.('.dx-search')) hideResults();
});
// "/" anywhere jumps to the search, as on docs.mendix.com; Esc closes the drawer.
addEventListener('keydown', (e) => {
  const typing = (e.target as Element).closest?.('input, textarea, select, [contenteditable="true"]');
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    q.focus();
    q.select();
  } else if (e.key === 'Escape') closeDrawer();
});

// ---- Loading the bundle -----------------------------------------------------------------------------
async function load() {
  main.replaceChildren(h('p.dx-loading', {}, 'Loading the docs…'));
  try {
    const res = await fetch('/docs/site.json', { credentials: 'same-origin' });
    if (res.status === 401 || res.redirected) return location.assign(`/login?next=${encodeURIComponent(location.pathname)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    bundle = (await res.json()) as DocBundle;
    const search = new URLSearchParams(location.search).get('q');
    if (search && slugFromPath(location.pathname) === 'search') q.value = search;
    show('hash');
  } catch (err) {
    main.replaceChildren(
      h('article.dx-article', {}, h('h1.dx-title', {}, 'The docs could not be loaded'), h('p', {}, `${(err as Error).message}. The office may be restarting: reload in a moment. When running from source, run `, h('code', {}, 'npm run build'), ' first.')),
    );
  }
}
void load();
