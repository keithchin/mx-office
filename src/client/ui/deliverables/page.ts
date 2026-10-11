// 📄 The Documents page of the 1D view (?tab=documents): every team's documents by toolkit stage, each
// on main, on a branch not merged yet, a draft or missing (panel.ts draws the list), with a search, a
// filter by status, when the office last looked and Refresh. It shows at once: the last answer kept
// (store.ts) or a skeleton, then the list when the office answers; a document opens in the viewer
// (viewer.ts). It asks the office when it's shown, every half minute while it's showing, and on Refresh,
// never more than one request at a time.

import { stageCounts, type DeliverableItem, type DeliverablesView } from '../../../shared/deliverables';
import { countOf, filterItems, FILTERS, type Filter } from './page-logic';
import { store } from '../../state';
import { h, timeAgo } from '../dom';
import { deliverablesList } from './panel';
import { cachedDocs, docsLoading, loadDocs, onDocs } from './store';

/** While the page is showing, it asks again this often. */
const POLL_MS = 30_000;

/** A few grey bars where the list will be. */
function skeleton(): HTMLElement {
  const bars = (n: number) => Array.from({ length: n }, () => h('div.dv-skel-item', {}, h('span.dv-skel-line.dv-skel-short'), h('span.dv-skel-line')));
  return h('div.dv-skel', { 'aria-hidden': 'true' }, ...[3, 4, 2].map((n) => h('section.dv-skel-stage', {}, h('span.dv-skel-line.dv-skel-head'), h('div.dv-skel-items', {}, ...bars(n)))));
}

export interface DocumentsPage {
  show(): void;
  hide(): void;
}

export function documentsPage(root: HTMLElement): DocumentsPage {
  let visible = false;
  let filter: Filter = 'all';
  let query = '';
  let drawn = '';
  let poll: ReturnType<typeof setInterval> | undefined;

  const search = h('input.dv-page-search', { type: 'search', placeholder: 'Find a document…', 'aria-label': 'Find a document' }) as HTMLInputElement;
  const chips = h('div.dv-page-chips', { role: 'group', 'aria-label': 'Show' });
  const when = h('span.dv-page-when', { 'aria-live': 'polite' });
  const refresh = h('button.btn.small.dv-page-refresh', { type: 'button', title: 'Look again now: main, the team’s worktrees and the office branches' }, 'Refresh') as HTMLButtonElement;
  const body = h('div.dv-page-body');
  root.replaceChildren(
    h('div.dv-page', {}, h('h2.lite-h.dv-page-h', {}, '📄 Documents'), h('div.dv-page-bar', {}, search, chips, h('span.dv-page-gap'), when, refresh), body),
  );

  const floor = () => store.floor ?? '';

  function drawChips(items: readonly DeliverableItem[] | undefined) {
    chips.replaceChildren(
      ...FILTERS.map((f) =>
        h(
          'button.dv-page-chip',
          { type: 'button', class: f.id === filter ? 'on' : '', 'aria-pressed': String(f.id === filter), 'data-filter': f.id, onclick: () => ((filter = f.id), draw(true)) },
          f.label,
          items ? h('span.dv-page-n', {}, String(countOf(items, f.id))) : null,
        ),
      ),
    );
  }

  function drawWhen(view: DeliverablesView | undefined) {
    const f = floor();
    const busy = docsLoading(f);
    refresh.disabled = busy;
    refresh.textContent = busy ? 'Looking…' : 'Refresh';
    when.textContent = view ? `Looked ${timeAgo(view.scannedAt)}` : busy ? 'Looking for documents…' : '';
  }

  /** Draws what's kept for the floor (a skeleton when nothing is yet); the list only when it changed. */
  function draw(force = false) {
    if (!visible) return;
    const f = floor();
    const view = cachedDocs(f)?.view;
    drawWhen(view);
    if (!view) {
      drawChips(undefined);
      if (drawn !== 'skeleton' && drawn !== 'empty') body.replaceChildren(docsLoading(f) ? skeleton() : h('p.tm-dim', {}, 'No documents to show.'));
      drawn = docsLoading(f) ? 'skeleton' : 'empty';
      return;
    }
    // Drawn again only when what it lists changed (a new scan finding the same leaves an open "n more" open).
    const sig = `${f}|${filter}|${query}|${JSON.stringify(view.items)}|${JSON.stringify(view.sources)}|${JSON.stringify(view.checkout ?? null)}`;
    if (!force && sig === drawn) return;
    drawn = sig;
    drawChips(view.items);
    const items = filterItems(view.items, filter, query);
    if (!items.length) {
      body.replaceChildren(h('p.dv-page-none', {}, query || filter !== 'all' ? 'No document matches.' : 'No documents yet.'));
      return;
    }
    const counts = stageCounts(view.items);
    const expected = counts.reduce((n, c) => n + c.expected, 0);
    const present = counts.reduce((n, c) => n + c.present, 0);
    body.replaceChildren(h('p.dv-page-sum', {}, `${present} of ${expected} expected documents on main`), deliverablesList(f, { ...view, items }, true));
  }

  const ask = (fresh = false) => {
    const f = floor();
    if (!f) return;
    void loadDocs(f, { fresh });
    draw();
  };

  refresh.addEventListener('click', () => ask(true));
  let typing: ReturnType<typeof setTimeout> | undefined;
  search.addEventListener('input', () => {
    clearTimeout(typing);
    typing = setTimeout(() => ((query = search.value), draw()), 120);
  });
  onDocs((f) => f === floor() && draw());
  store.on('floor', () => {
    drawn = '';
    if (visible) ask();
  });

  return {
    show() {
      if (visible) return;
      visible = true;
      drawn = '';
      draw();
      ask();
      poll = setInterval(() => ask(), POLL_MS);
    },
    hide() {
      visible = false;
      clearInterval(poll);
      poll = undefined;
    },
  };
}
