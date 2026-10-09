import './portal.css';
/**
 * Home as the Portal themes' Projects page (home/projects.ts hands its tab over to this while a Portal
 * theme is on): the page's title with New project and Add project over Home's tabs, then a filter row
 * (search by name, a status select, the sort with its direction, Pause all), and a card per project in a
 * grid. A card has its tile (the project's letters in its floor's colour), its name (to its board), what
 * it is, its 👁 (watch: shared/project-prefs.ts), its pin (pinned ones first under "Pinned", kept in
 * this browser) and its ⋯ (open the board or the office, the live app, Edit in Studio Pro, Pause or
 * Resume it), and at the bottom its progress, its status and its spend. What it shows and in what order
 * is home/portal-logic.ts. It asks the office for nothing new: the floors are the store's, the run
 * state home/run-state.ts's (already kept up to date for Home), the spend one GET /api/budget/office
 * when the tab is drawn, the progress ui/progress/mini.ts's.
 */
import type { Net } from '../net';
import { store } from '../state';
import type { FloorInfo } from '../../shared/protocol';
import type { OfficeBudgetView } from '../../shared/budget/types';
import { floorPalette } from '../../shared/floors';
import { usd } from '../../shared/budget/money';
import { h, toast } from '../ui/dom';
import { confirmDialog } from '../ui/prompt';
import { icon } from '../ui/portal/icons';
import { openPop, type PopItem } from '../ui/portal/pop';
import { miniProgress } from '../ui/progress/mini';
import { summaryLine } from '../ui/summary';
import { startPause, startResume } from '../ui/project-run/api';
import { openDeleteDialog } from '../ui/project-delete/dialog';
import { isPinned, isWatched, onProjectPrefs, setPinned, setWatched } from '../shared/project-prefs';
import { homeRunState, homeRunToggle, onHomeRunState, refreshHomeRunState } from './run-state';
import { activityScore, SORTS, STATUS_FILTERS, statusOf, tileLetters, visibleProjects, type SortKey, type StatusFilter } from './portal-logic';

const PREFS = 'agent-office.portal-projects';
const STATUS_WORD = { 'needs-you': 'Needs you', running: 'Running', paused: 'Paused', adding: 'Being added' } as const;

export interface PortalDeps {
  net: Net;
  /** The floor this browser was last on (marked on its card). */
  last: string | null;
  /** Into a floor, on the board or in the office from above (home/projects.ts openFloor). */
  open: (floor: string, view: '1d' | '2d') => void;
  newProject: () => void;
  addProject: () => void;
  connections?: () => void;
}

const floorUrl = (id: string, extra = '') => `/lite?floor=${encodeURIComponent(id)}${extra}`;

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

  // ---- What the cards say ------------------------------------------------------------------------
  let budget: OfficeBudgetView | undefined;
  let asked = 0;
  const askBudget = () => {
    if (Date.now() - asked < 60_000) return;
    asked = Date.now();
    void fetch('/api/budget/office', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<OfficeBudgetView>) : undefined))
      .then((v) => {
        if (!v) return;
        budget = v;
        drawGrid();
      })
      .catch(() => undefined);
  };
  const spendOf = (id: string) => budget?.floors.find((b) => b.id === id);
  const paused = (id: string) => {
    const k = homeRunState(id)?.kind;
    return k === 'paused' || k === 'pausing';
  };
  const facts = {
    paused,
    pinned: isPinned,
    activity: (id: string) => {
      const f = store.floors.find((x) => x.id === id);
      return activityScore(spendOf(id)?.spark, f?.busy ?? 0, f?.waiting ?? 0);
    },
  };
  const summaries = new Map<string, string>();

  const toggle = (cls: string, on: boolean, label: [string, string], ico: [Parameters<typeof icon>[0], Parameters<typeof icon>[0]], flip: () => void) => {
    const b = h(`button.ph-icon.${cls}`, { type: 'button', 'aria-pressed': String(on), 'aria-label': on ? label[0] : label[1], title: on ? label[0] : label[1] }, icon(on ? ico[0] : ico[1]));
    b.addEventListener('click', flip);
    return b;
  };

  const moreItems = (f: FloorInfo): PopItem[] => {
    const items: PopItem[] = [
      { label: 'Open the board', hint: 'Its pipeline, agents and tabs', href: floorUrl(f.id), run: () => deps.open(f.id, '1d') },
      { label: 'Open the office', hint: 'From above, every agent at a desk', href: `/pixel?floor=${encodeURIComponent(f.id)}`, run: () => deps.open(f.id, '2d') },
      { label: 'View live app', hint: 'The app running from main', href: floorUrl(f.id, '&tab=live') },
      { label: 'Edit in Studio Pro', hint: 'Opens on the office’s computer (admins)', href: floorUrl(f.id, '&open=studio') },
    ];
    if (store.me.admin) {
      const k = homeRunState(f.id)?.kind;
      if (k === 'paused') items.push({ label: 'Resume project', hint: 'Wake its agents with work waiting', run: () => confirmRun(f, 'resume') });
      else if (k === 'running') items.push({ label: 'Pause project', hint: 'Agents finish their turn, then sleep', run: () => confirmRun(f, 'pause') });
      if (!f.cloning) items.push({ label: 'Delete…', hint: 'Remove it from the office, or delete it for good', run: () => openDeleteDialog(f.id, f.name, 'delete') });
    }
    return items;
  };
  const confirmRun = (f: FloorInfo, action: 'pause' | 'resume') => {
    const pause = action === 'pause';
    confirmDialog(
      pause ? `Pause ${f.name}` : `Resume ${f.name}`,
      pause ? 'Its agents finish their current turn, write a handoff note and sleep; office prompts are held until it is resumed. Your messages still go through.' : 'Wakes the agents that have work waiting, a few at a time.',
      pause ? 'Pause' : 'Resume',
      () =>
        void (pause ? startPause(f.id) : startResume(f.id, { mode: 'work' })).then((r) => {
          if (!r) return;
          toast(pause ? `Pausing ${f.name}` : `Resuming ${f.name}`);
          setTimeout(refreshHomeRunState, 600);
        }),
    );
  };

  const card = (f: FloorInfo) => {
    const st = statusOf(f, facts);
    const pinned = isPinned(f.id);
    const watched = isWatched(f.id);
    const more = h('button.ph-icon.ph-more', { type: 'button', 'aria-label': `More for ${f.name}`, title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
    more.addEventListener('click', () => openPop(more, moreItems(f), { label: `${f.name}: more`, align: 'right' }));
    const spend = spendOf(f.id);
    const name = h('a.ph-name', { href: floorUrl(f.id), title: `${f.name}: its board` }, f.name);
    name.addEventListener('click', (e) => {
      e.preventDefault();
      if (!f.cloning) deps.open(f.id, '1d');
    });
    const sub = [f.repo ?? 'Local folder', f.branch && f.branch !== 'HEAD' ? `⎇ ${f.branch}` : ''].filter(Boolean).join(' · ');
    const people = [f.busy && `${f.busy} working`, `${f.workers} agent${f.workers === 1 ? '' : 's'}`, f.people && `${f.people} here`].filter(Boolean).join(' · ');
    const summary = h('p.ph-line', {}, summaries.get(f.id) ?? people);
    if (!summaries.has(f.id) && !f.cloning) void summaryLine(f.id).then((t) => (summaries.set(f.id, t), summary.isConnected && t && (summary.textContent = t)));
    return h(
      'li.ph-card',
      { class: `${f.id === deps.last ? 'here' : ''} st-${st}`, style: `--tile:${floorPalette(f.palette).trim}`, 'data-floor': f.id },
      h(
        'div.ph-card-head',
        {},
        h('span.ph-tile', { 'aria-hidden': 'true' }, tileLetters(f.name)),
        h(
          'div.ph-acts',
          {},
          toggle('ph-watch', watched, [`Watching ${f.name}: it calls you over when someone's waiting. Click to stop`, `Not watching ${f.name}. Click to watch it`], ['eye', 'eyeOff'], () => setWatched(f.id, !watched)),
          toggle('ph-pin', pinned, [`Pinned: ${f.name} comes first. Click to unpin`, `Pin ${f.name} to the top`], ['pinned', 'pin'], () => setPinned(f.id, !pinned)),
          more,
        ),
      ),
      h('h3.ph-h', {}, name),
      h('p.ph-sub', { title: f.dir }, sub),
      summary,
      f.cloning ? h('p.ph-line', {}, f.clone?.step ?? 'Being added…') : miniProgress(f.id),
      h(
        'div.ph-foot',
        {},
        h('span.ph-status', { 'data-st': st }, STATUS_WORD[st]),
        spend ? h('span.ph-spend', { title: spend.budget ? `${usd(spend.spent)} of ${usd(spend.budget)} spent` : `${usd(spend.spent)} spent` }, spend.budget ? `${usd(spend.spent)} / ${usd(spend.budget)}` : `${usd(spend.spent)} spent`) : null,
        f.id === deps.last ? h('span.ph-here', {}, 'Last visited') : null,
      ),
    );
  };

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
        root.replaceChildren(filters, count, grid);
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
