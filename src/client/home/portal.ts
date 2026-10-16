import './portal.css';
/**
 * Home as the Portal themes' Projects page (home/projects.ts hands its tab over to this while a Portal
 * theme is on): the page's title with New project and Add project over Home's tabs, then a filter row
 * (search by name, a status select, the sort with its direction, Pause all), and a card per project in a
 * grid of the cards home/project-card.ts draws. A card has its tile (the project's letters in its floor's colour), its name (to its board), what
 * it is, its 👁 (watch: shared/project-prefs.ts), its pin (pinned ones first under "Pinned", kept in
 * this browser) and its ⋯ (open the project, the live app, Edit in Studio Pro, Pause or
 * Resume it), and at the bottom its progress, its status and its spend. What it shows and in what order
 * is home/portal-logic.ts. It asks the office for nothing new: the floors are the store's, the run
 * state home/run-state.ts's (already kept up to date for Home), the spend one GET /api/budget/office
 * when the tab is drawn, the progress ui/progress/mini.ts's.
 */
import type { Net } from '../net';
import { store } from '../state';
import { h } from '../ui/dom';
import { icon } from '../ui/portal/icons';
import { onProjectPrefs } from '../shared/project-prefs';
import { homeRunToggle, onHomeRunState } from './run-state';
import { SORTS, STATUS_FILTERS, visibleProjects, type SortKey, type StatusFilter } from './portal-logic';
import { projectCards } from './project-card';

const PREFS = 'agent-office.portal-projects';

export interface PortalDeps {
  net: Net;
  /** The floor this browser was last on (marked on its card). */
  last: string | null;
  /** Into a floor: its 1D view (home/projects.ts openFloor). */
  open: (floor: string) => void;
  newProject: () => void;
  addProject: () => void;
  connections?: () => void;
  /** The new-project setups that didn't finish (ui/wizard/unfinished.ts), over the filter row. */
  unfinished?: HTMLElement;
}

/** The page's title and its two buttons, over Home's tabs (shown in a Portal theme only). */
export function portalHead(main: HTMLElement, deps: Pick<PortalDeps, 'newProject' | 'addProject'>) {
  const head = h(
    'div.ph-head.pt-only',
    {},
    h('h1.ph-title', {}, 'Projects'),
    h(
      'div.ph-head-acts',
      {},
      h('button.btn.ph-outline', { type: 'button', title: "Clone one of the repositories this office's gh login can see, as a new project", onclick: deps.addProject }, 'Add project'),
      h('button.btn.primary', { type: 'button', title: 'Create a new project repository and set it up with the mxcli project toolkit, a step at a time', onclick: deps.newProject }, 'New project'),
    ),
  );
  main.prepend(head);
}

/** The Projects tab in the Portal look: built once, its grid drawn again on every change. */
export function portalProjects(root: HTMLElement, deps: PortalDeps) {
  let prefs: { status: StatusFilter; sort: SortKey; desc: boolean } = { status: 'all', sort: 'pinned', desc: false };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? '{}');
    if (STATUS_FILTERS.some((s) => s.id === v.status)) prefs.status = v.status;
    if (SORTS.some((s) => s.id === v.sort)) prefs.sort = v.sort;
    prefs.desc = v.desc === true;
  } catch {
    // The usual order, then.
  }
  const save = () => {
    try {
      localStorage.setItem(PREFS, JSON.stringify(prefs));
    } catch {
      // Just for this visit.
    }
  };

  // ---- The filter row ----------------------------------------------------------------------------
  const text = h('input.ph-q', { type: 'search', placeholder: 'Search by project name', 'aria-label': 'Search by project name', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
  const status = h('select.ph-select', { 'aria-label': 'Status' }, ...STATUS_FILTERS.map((s) => h('option', { value: s.id }, s.label))) as HTMLSelectElement;
  const sort = h('select.ph-select.ph-sort', { 'aria-label': 'Sort by' }, ...SORTS.map((s) => h('option', { value: s.id }, s.label))) as HTMLSelectElement;
  const dir = h('button.ph-dir', { type: 'button' }) as HTMLButtonElement;
  status.value = prefs.status;
  sort.value = prefs.sort;
  const drawDir = () => {
    dir.replaceChildren(icon(prefs.desc ? 'sortUp' : 'sort'));
    dir.setAttribute('aria-pressed', String(prefs.desc));
    dir.setAttribute('aria-label', prefs.desc ? 'Reversed order: click for the usual order' : 'Usual order: click to reverse');
    dir.title = prefs.desc ? 'Reversed: click for the usual order' : 'Reverse the order';
  };
  drawDir();
  const run = h('span.ph-run', {});
  const count = h('p.ph-count', { role: 'status', 'aria-live': 'polite' });
  const filters = h(
    'div.ph-filters',
    {},
    h('label.ph-search', {}, text, icon('search', 'ph-search-ico')),
    status,
    h('span.ph-grow', {}),
    h('span.ph-sortbox', {}, sort, dir),
    run,
  );
  const grid = h('ul.ph-grid', { 'aria-label': 'Projects' });
  text.addEventListener('input', () => drawGrid());
  status.addEventListener('change', () => ((prefs.status = status.value as StatusFilter), save(), drawGrid()));
  sort.addEventListener('change', () => ((prefs.sort = sort.value as SortKey), save(), drawGrid()));
  dir.addEventListener('click', () => ((prefs.desc = !prefs.desc), save(), drawDir(), drawGrid()));

  // ---- The cards (home/project-card.ts, shared with a client's page) -------------------------------
  const { card, facts, askBudget } = projectCards({ last: deps.last, open: deps.open, redraw: () => drawGrid() });

  function drawGrid() {
    const shown = visibleProjects(store.floors, { text: text.value, status: prefs.status, sort: prefs.sort, desc: prefs.desc }, facts);
    grid.replaceChildren(...shown.map(card));
    const n = store.floors.length;
    count.textContent = !n
      ? 'No projects yet: New project creates one, Add project clones one of your repositories.'
      : shown.length === n
        ? `${n} project${n === 1 ? '' : 's'}`
        : `${shown.length} of ${n} projects`;
  }

  onProjectPrefs(() => root.isConnected && drawGrid());
  onHomeRunState(() => root.isConnected && grid.isConnected && drawGrid());

  return {
    render() {
      if (!filters.isConnected) {
        root.replaceChildren(...(deps.unfinished ? [deps.unfinished] : []), filters, count, grid);
        askBudget();
      }
      // The Pause all / Resume all button (home/run-state.ts), drawn again for who you are.
      const t = homeRunToggle();
      run.replaceChildren(...(t ? [t] : []));
      if (deps.connections && store.me.admin && !run.querySelector('.ph-conn')) run.append(h('button.btn.ph-outline.ph-conn', { type: 'button', title: 'The GitHub and Mendix tokens, the password, git & gh and the folders the office uses', onclick: deps.connections }, 'Connections'));
      drawGrid();
    },
    /** Out of the page (another theme took over): drawn fresh next time. */
    detach() {
      filters.remove();
      count.remove();
      grid.remove();
    },
  };
}
