// The Clients page (/clients, clients.ts): every client as a card in the Projects page's grid (name, how many
// projects and which, the company brain's state), ＋ New client, and a client's own page
// (/clients?client=<id>): its name with Rename, its brain's state with Connect a brain / Disconnect, ＋ Add a
// project, and its projects drawn with the very cards of the Projects page (home/project-card.ts).
// "Clients organise knowledge; they aren't access control" is said on both. GET /api/portfolios is asked
// when the page opens and answered again by every change; the project cards follow the socket's floors.

import { NOT_ACCESS_CONTROL, NOT_ACCESS_CONTROL_LONG, type PortfoliosView, type PortfolioView } from '../../shared/portfolios';
import { floorPalette } from '../../shared/floors';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';
import { h } from '../ui/dom';
import { icon } from '../ui/portal/icons';
import { openPop, type PopItem } from '../ui/portal/pop';
import { portfoliosView, type ActResult } from '../ui/portfolios/api';
import { addToPortfolioDialog, newPortfolioDialog, renameClientDialog } from '../ui/portfolios/dialogs';
import { projectCards } from '../home/project-card';
import { tileLetters } from '../home/portal-logic';
import { onHomeRunState } from '../home/run-state';
import { onProjectPrefs } from '../shared/project-prefs';
import { brainButton, brainPart, chip } from './brain';
import { clientHref, clientMatches, paletteOf, sortedClients } from './logic';
import '../ui/portfolios/portfolios.css';
import './clients.css';

export interface ClientsDeps {
  /** The floor this browser was last on (marked on its card). */
  last: string | null;
  /** Into a project (its 1D view). */
  open: (floor: string) => void;
}

const banner = () => h('div.pf-banner', { role: 'note' }, h('strong', {}, `🔓 ${NOT_ACCESS_CONTROL}. `), NOT_ACCESS_CONTROL_LONG);

export function clientsView(root: HTMLElement, deps: ClientsDeps) {
  let view: PortfoliosView | undefined;
  let failed: string | undefined;
  let open = new URLSearchParams(location.search).get('client') ?? undefined;
  /** Where focus goes once the page is drawn again (the card or button a dialog came from). */
  let focusAfter: string | undefined;
  const cards = projectCards({ last: deps.last, open: deps.open, redraw: () => render() });
  const text = h('input.ph-q', { type: 'search', placeholder: 'Search by client name', 'aria-label': 'Search by client name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  text.addEventListener('input', () => drawGrid());
  const grid = h('ul.ph-grid.cl-grid', { 'aria-label': 'Clients' });
  const count = h('p.ph-count', { role: 'status', 'aria-live': 'polite' });

  const admin = () => !!view?.admin && store.me.admin;
  const after = (r: ActResult) => {
    if (r.view) view = r.view;
    render();
  };
  const go = (id: string | undefined, push = true) => {
    open = id;
    if (push) history.pushState(null, '', clientHref(id));
    render();
    scrollTo({ top: 0 });
  };
  addEventListener('popstate', () => go(new URLSearchParams(location.search).get('client') ?? undefined, false));

  const renameItem = (p: PortfolioView, opener: HTMLElement) => renameClientDialog(opener, p, (r) => ((focusAfter = `[data-client="${p.id}"] .ph-more, .cl-rename`), after(r)));

  // ---- The overview: a card per client ------------------------------------------------------------
  const clientCard = (p: PortfolioView, floors: FloorInfo[]) => {
    const mine = p.projectIds.map((id) => floors.find((f) => f.id === id)).filter((f): f is FloorInfo => !!f);
    const more = h('button.ph-icon.ph-more', { type: 'button', 'aria-label': `More for ${p.label}`, title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
    more.addEventListener('click', () => {
      const items: PopItem[] = [{ label: 'Open client', hint: 'Its projects and its company brain', href: clientHref(p.id), run: () => go(p.id) }];
      if (admin()) items.push({ label: 'Rename…', hint: 'Only the name changes', run: () => renameItem(p, more) });
      openPop(more, items, { label: `${p.label}: more`, align: 'right' });
    });
    const name = h('a.ph-name', { href: clientHref(p.id), title: `${p.label}: its projects and company brain` }, p.label);
    name.addEventListener('click', (e) => {
      e.preventDefault();
      go(p.id);
    });
    const n = p.projects.length;
    return h(
      'li.ph-card.cl-card',
      { style: `--tile:${floorPalette(paletteOf(p.id)).trim}`, 'data-client': p.id },
      h('div.ph-card-head', {}, h('span.ph-tile', { 'aria-hidden': 'true' }, tileLetters(p.label)), h('div.ph-acts', {}, more)),
      h('h3.ph-h', {}, name),
      h('p.ph-sub', {}, `${n} project${n === 1 ? '' : 's'}`),
      h('p.ph-line', {}, n ? p.projects.map((x) => x.name).join(', ') : 'No projects yet'),
      mine.length ? h('div.cl-tiles', { 'aria-hidden': 'true' }, ...mine.slice(0, 6).map((f) => h('span.cl-mini', { style: `--tile:${floorPalette(f.palette).trim}`, title: f.name }, tileLetters(f.name))), mine.length > 6 ? h('span.cl-more', {}, `+${mine.length - 6}`) : null) : null,
      h('div.ph-foot', {}, chip(p)),
    );
  };

  function drawGrid() {
    if (!view) return;
    const all = sortedClients(view.portfolios);
    const shown = all.filter((p) => clientMatches(p, text.value));
    grid.replaceChildren(...shown.map((p) => clientCard(p, store.floors)));
    const n = all.length;
    count.textContent = !n
      ? `No clients yet${admin() ? ': ＋ New client makes one' : ''}. Projects work on their own as always; a client groups one company’s projects and points them at the same company brain.`
      : shown.length === n
        ? `${n} client${n === 1 ? '' : 's'} · ${view.ungrouped.length} project${view.ungrouped.length === 1 ? '' : 's'} without a client`
        : `${shown.length} of ${n} clients`;
  }

  function overview(): HTMLElement[] {
    const add = admin() ? (h('button.btn.primary.cl-new', { type: 'button', title: 'A new client: the company or organisation you build for' }, '＋ New client') as HTMLButtonElement) : null;
    if (add) add.onclick = () => newPortfolioDialog(add, (r) => ((focusAfter = r.portfolio ? `[data-client="${r.portfolio.id}"] .ph-name` : '.cl-new'), after(r)));
    drawGrid();
    return [
      h('div.ph-head', {}, h('h1.ph-title', {}, 'Clients'), h('div.ph-head-acts', {}, add)),
      banner(),
      h('div.ph-filters', {}, h('label.ph-search', {}, text, icon('search', 'ph-search-ico'))),
      count,
      grid,
    ];
  }

  // ---- A client's page ------------------------------------------------------------------------------
  function page(v: PortfoliosView, p: PortfolioView): (HTMLElement | null)[] {
    const a = admin();
    const rename = a ? (h('button.btn.ph-outline.cl-rename', { type: 'button', title: 'A new name for this client (its projects and brain stay)' }, 'Rename') as HTMLButtonElement) : null;
    if (rename) rename.onclick = () => renameItem(p, rename);
    const addP = a ? (h('button.btn.ph-outline.cl-add', { type: 'button', title: 'Put a project without a client in this one' }, '＋ Add project') as HTMLButtonElement) : null;
    if (addP) addP.onclick = () => addToPortfolioDialog(addP, v, { portfolio: p.id }, (r) => ((focusAfter = '.cl-add'), after(r)));
    const mine = p.projectIds.map((id) => store.floors.find((f) => f.id === id)).filter((f): f is FloorInfo => !!f);
    const gone = p.projects.filter((x) => !store.floors.some((f) => f.id === x.id));
    const wiring = p.projects.filter((x) => x.wiring && !x.wiring.ok);
    if (mine.length) cards.askBudget();
    return [
      h('p.cl-crumb', {}, h('a.cl-back', { href: '/clients', onclick: (e: Event) => (e.preventDefault(), go(undefined)) }, '← All clients')),
      h('div.ph-head', {}, h('div.cl-title', {}, h('h1.ph-title', {}, p.label), chip(p)), h('div.ph-head-acts', {}, rename, addP, a ? brainButton(p, after) : null)),
      banner(),
      h('h2.cl-h', {}, `Projects (${p.projects.length})`),
      mine.length ? h('ul.ph-grid', { 'aria-label': `${p.label}'s projects` }, ...mine.map(cards.card)) : h('p.ph-count', {}, a ? 'No projects yet: ＋ Add project puts one of the projects without a client in it.' : 'No projects yet.'),
      gone.length ? h('p.pf-hint', {}, `Not in the office now: ${gone.map((x) => x.name).join(', ')}.`) : null,
      ...wiring.map((x) => h('p.pf-warn', {}, `⚠️ ${x.name}: company brain wiring incomplete (${x.wiring!.problems.join('; ')}). See Needs you on the project.`)),
      brainPart(p),
    ];
  }

  function render() {
    if (!root.isConnected) return;
    if (!view) return void root.replaceChildren(h('p.ph-count', {}, failed ? `Couldn’t ask the office: ${failed}` : 'Asking the office…'));
    const p = open ? view.portfolios.find((x) => x.id === open) : undefined;
    if (open && !p) {
      root.replaceChildren(h('p.cl-crumb', {}, h('a.cl-back', { href: '/clients', onclick: (e: Event) => (e.preventDefault(), go(undefined)) }, '← All clients')), h('p.ph-count', {}, 'There is no such client (it may have been made in another office, or the link is old).'));
      return;
    }
    document.title = p ? `${p.label} · Clients · Mx Office` : 'Clients · Mx Office';
    root.replaceChildren(...(p ? page(view, p) : overview()).filter((x): x is HTMLElement => !!x));
    if (focusAfter) {
      root.querySelector<HTMLElement>(focusAfter)?.focus();
      focusAfter = undefined;
    }
  }

  async function load() {
    try {
      view = await portfoliosView();
      failed = undefined;
    } catch (err) {
      failed = (err as Error).message;
    }
    render();
  }

  // The cards follow the floors (live over the socket); on the overview only the grid is
  // drawn again, so the search box keeps what's typed and its focus. A client's page follows the projects'
  // run state and their pins too, as the Projects page does.
  const refresh = () => {
    if (!view) return;
    if (!open && grid.isConnected) drawGrid();
    else render();
  };
  store.on('floors', refresh);
  // Who you are decides the admin buttons (＋ New client, Rename…): the whole page.
  store.on('me', () => view && render());
  onHomeRunState(() => open && render());
  onProjectPrefs(() => open && render());
  void load();
  return { render, open: (id: string | undefined) => go(id) };
}
