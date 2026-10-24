// The Developer view's explorer: a sidebar on the left of the canvas, like a file explorer, loaded with the
// App section's first show (the shell imports it then). It reads the repository at a revision, main's newest
// commit unless the viewer picks the live app's (./revision.ts), so it works the same with the app stopped,
// starting or failed: the live app's revision is only shown as information. Two views of that revision:
//
//   business (default)  Pages (titles, folders as in the model, Marketplace modules folded), Data, Logic
//                       (server/app-explorer/: from the app's units), then Documents, Process map and Design
//                       (the documents with their relationships, ./docs.ts), in plain words
//   all files           "Show all files": the project's raw files at that revision, read-only, minus what the
//                       server never shows (shared/app-explorer.ts deniedPath, the .gitignore)
//
// Opening a page shows its Model preview (from the model, not the running app) in the pane, never the live
// app's frame; the selected row's bar has Open in the live app for a page with an address while the app
// runs, Request a change (with the item as context) and, for admins, Change this. Data and logic open their
// diagrams, a document its card (./doc-card.ts), a file its text or picture (./pane.ts).
//
// Levels are fetched when first opened and kept per revision (./api.ts). The search looks through every
// level (the whole tree in one request, folded groups too) or, in all files, every file of the revision.
// Nothing polls: main's newest commit is asked when the project opens, when the live app's revision moves
// and when the window gets the focus back; if main moved, the tree says it's stale and Show it reads the
// new revision (the open levels again, the changed rows dotted).
//
// Width, collapsed and the switch are remembered per viewer (this browser). « collapses it to an icon rail,
// as the Portal navigation and the coordinator's panel fold: », Find, Pages, Data, Logic, Documents, Process
// map, Design and Show all files, each with its name as the tooltip; a click opens the explorer at that
// section (or in the search box). Nothing is fetched again by folding or unfolding. At a phone's width it's a
// drawer opened by a button. Keyboard and ARIA: ./tree.ts.

import { h } from '../../dom';
import { type ExplorerHead, type ExplorerNode } from '../../../../shared/app-explorer';
import type { DocumentsView } from '../../../../shared/app-documents';
import type { DeliverablesView } from '../../../../shared/deliverables';
import type { WorkspaceData } from '../data';
import { explorerApi, type ExplorerApi } from './api';
import { DOC_PREFIX, docGroups } from './docs';
import { docPane, type Pane, type PaneDeps } from './pane';
import type { ElementContext } from './element-ref';
import { explorerRail, type RailTarget } from './rail';
import { revisionLine } from './revision';
import { TreeView, type TreeModel } from './tree';
import { markDots } from './dots';
import { firstPage } from './first-page';
import './explorer.css';

export const PREFS_KEY = 'agent-office.aw.explorer';
const W_MIN = 180;
const W_MAX = 520;

interface Prefs {
  w: number;
  collapsed: boolean;
  all: boolean;
}

function recall(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { w: clampW(Number(p.w) || 280), collapsed: p.collapsed === true, all: p.all === true };
  } catch {
    return { w: 280, collapsed: false, all: false };
  }
}
const clampW = (w: number) => Math.max(W_MIN, Math.min(W_MAX, Math.round(w)));

export interface ExplorerDeps {
  /** What the workspace shows (the project, the live app, admin). */
  data(): WorkspaceData;
  /** Opens a path of the live app in the canvas (only from Open in the live app). */
  go(path: string): void;
  /** Where the canvas is. */
  where(): { path: string; moved: boolean } | undefined;
  /** Shows the pane (true) or the live app's canvas (false) in the canvas's place. */
  pane(on: boolean): void;
  /**
   * Request a change about an item ("Page: Visitor list"), with the page's path when it has one, and for a page
   * its model reference (the page, or the widget picked on its Model preview) and the revision viewed.
   */
  request(about: string, page?: string, at?: { element: ElementContext; rev: string; words?: string }): void;
  /** What's selected changed: the item opened (a page with the widget picked on it, at the revision shown), or none. */
  selection?(s: ExplorerSelection | undefined): void;
  /** Tests: the requests, the documents viewer, Change this, the Model tab's requests. */
  api?: ExplorerApi;
  docs?(floor: string): Promise<DeliverablesView | undefined>;
  openDoc?(floor: string, path: string, view?: DeliverablesView): void;
  changeThis?(o: { floor: string; ref: string; sha?: string; kind: string; qn: string; back: () => void }): void;
  model?: PaneDeps['api'];
}

/** What the explorer has open, as context for a request ("Page: My orders", the page or widget, the revision). */
export interface ExplorerSelection {
  about: string;
  element?: ElementContext;
  rev?: string;
  page?: string;
}

export interface Explorer {
  readonly el: HTMLElement;
  readonly pane: Pane;
  /** Opens the app's first page in the Model preview, when nothing is open yet (once per revision). */
  openFirst(): void;
  /** The workspace drew: follow the project and the live app's revision. */
  update(d: WorkspaceData): void;
}

const CHANGE_KINDS = new Set(['page', 'microflow', 'nanoflow', 'entity']);
const servedOf = (d: WorkspaceData) => d.live?.served?.sha ?? d.live?.lastServed?.sha;
const ABOUT: Record<string, string> = { page: 'Page', entity: 'Data', domainmodel: 'Data', microflow: 'Logic', nanoflow: 'Logic', doc: 'Document', file: 'File' };
const isDocs = (id: string) => id.startsWith('docs:');
/** "Page: My orders", "Logic: Save order", "File: docs/brief.md". */
const aboutOf = (n: ExplorerNode) => `${ABOUT[n.kind === 'doc' ? 'doc' : n.kind === 'file' ? 'file' : n.type ?? ''] ?? 'Item'}: ${n.kind === 'file' ? n.path : n.label}`;

export function createExplorer(deps: ExplorerDeps): Explorer {
  const api = deps.api ?? explorerApi();
  const prefs = recall();
  const save = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // just for this visit
    }
  };
  const biz: TreeModel = { roots: [], kids: new Map(), expanded: new Set(), dots: new Set() };
  const files: TreeModel = { roots: [], kids: new Map(), expanded: new Set(), dots: new Set() };
  const found: TreeModel = { roots: [], kids: new Map(), expanded: new Set(), dots: new Set() };
  let floor: string | null = null;
  let head: ExplorerHead | undefined;
  let headError: string | undefined;
  let rev: string | undefined;
  let served: string | undefined;
  let onServed = false;
  let docsView: DocumentsView | undefined;
  let indexed: string | undefined;
  let opened: { path: string; key?: string } | undefined;
  let selected: ExplorerNode | undefined;
  let admin = false;
  let gen = 0;
  const searching = () => prefs.all && !!search.value.trim();
  const model = () => (searching() ? found : prefs.all ? files : biz);

  const tree = new TreeView(model(), { expand: (n) => void expand(n), open: (n) => openNode(n), select: (n) => ((selected = n ?? undefined), drawBar()), more: (p, c) => void more(p, c), changed: () => draw() }, 'The app');
  const pane = docPane({ floor: () => floor, rev: () => rev, back: () => backToApp(), live: () => !!deps.data().appUrl, file: (p) => api.file(floor!, rev!, p), openEntry: (id) => openEntry(id), ...(api.facts ? { facts: (qn: string) => (floor && rev ? api.facts!(floor, rev, qn) : Promise.resolve(undefined)) } : {}), request: (r) => askAbout(r.node, { element: r.element, rev: r.rev }), selected: (c, n) => deps.selection?.(n ? { about: aboutOf(n), ...(c ? { element: c } : {}), ...(rev ? { rev } : {}), ...(n.type === 'page' && n.url ? { page: n.url } : {}) } : undefined), ...(deps.model ? { api: deps.model } : {}) });
  const revLine = revisionLine({ pick: (w) => pick(w), refresh: () => void toRev(head?.rev) });

  const search = h('input.ax-search', { type: 'search', placeholder: 'Find a page, record, logic, document…', 'aria-label': 'Find in the explorer' }) as HTMLInputElement;
  const allBox = h('input.ax-all', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const allLabel = h('label.ax-switch', { title: 'The project’s files as they are, read-only (for builders and IT)' }, allBox, h('span', {}, 'Show all files'));
  const collapseBtn = h('button.ax-icon.ax-collapse', { type: 'button', 'aria-label': 'Collapse the explorer', title: 'Collapse the explorer to icons', 'aria-controls': 'ax-side' }, '«');
  const expandBtn = h('button.ax-icon.ax-expand', { type: 'button', 'aria-label': 'Expand the explorer', title: 'Expand the explorer', 'aria-controls': 'ax-side' }, '»');
  const rail = explorerRail(expandBtn, (at) => openAt(at));
  const heading = h('span.ax-title', {}, 'Explorer');
  const status = h('p.ax-status', { role: 'status' });
  const bar = h('div.ax-bar', { 'aria-live': 'polite' });
  const scroll = h('div.ax-scroll', {}, tree.el);
  const rows = h('div.ax-rows', {}, status, scroll, bar);
  const grip = h('div.ax-grip', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Explorer width', tabindex: '0', 'aria-valuemin': String(W_MIN), 'aria-valuemax': String(W_MAX) });
  const side = h('aside.ax-side', { id: 'ax-side', 'aria-label': 'Explorer' }, h('div.ax-head', {}, h('div.ax-headrow', {}, heading, h('span.aw-grow'), collapseBtn), revLine.el, search, allLabel), rows, rail.el, grip);
  const drawerBtn = h('button.aw-btn.ax-drawer-btn', { type: 'button', 'aria-controls': 'ax-side', 'aria-expanded': 'false' }, '☰ Browse the app');
  const scrim = h('div.ax-scrim', { 'aria-hidden': 'true' });
  const el = h('div.ax', {}, drawerBtn, side, scrim);

  // ---- Layout: width, collapsed, the phone's drawer ----------------------------------------------------
  function paintLayout() {
    el.style.setProperty('--ax-w', `${prefs.w}px`);
    el.classList.toggle('ax-collapsed', prefs.collapsed);
    grip.setAttribute('aria-valuenow', String(prefs.w));
    collapseBtn.setAttribute('aria-expanded', String(!prefs.collapsed));
    allBox.checked = prefs.all;
    heading.textContent = prefs.all ? 'All files' : 'Explorer';
    search.placeholder = prefs.all ? 'Find a file in this revision…' : 'Find a page, record, logic, document…';
    tree.setLabel(prefs.all ? 'The project’s files' : 'The app');
    paintRail();
  }
  function paintRail() {
    rail.paint(prefs.all, biz.roots);
  }
  /** A rail button: the explorer opens at that section (its group opened and focused), in the search box, or in all files. */
  function openAt(at: RailTarget) {
    prefs.collapsed = false;
    const wantAll = at === 'all';
    if (at !== 'find' && prefs.all !== wantAll) {
      allBox.checked = wantAll;
      allBox.dispatchEvent(new Event('change'));
    }
    save();
    paintLayout();
    if (at === 'find') return search.focus();
    if (wantAll) return void (tree.el.querySelector<HTMLElement>('[tabindex="0"]') ?? allBox).focus();
    const n = biz.roots.find((x) => x.id === at);
    if (!n) return search.focus();
    if (n.folder && !biz.expanded.has(n.id)) {
      biz.expanded.add(n.id);
      void expand(n);
    }
    selected = n;
    tree.selectedId = n.id;
    drawBar();
    draw();
    tree.focusRow(n.id);
  }
  collapseBtn.addEventListener('click', () => ((prefs.collapsed = true), save(), paintLayout(), expandBtn.focus()));
  expandBtn.addEventListener('click', () => ((prefs.collapsed = false), save(), paintLayout(), collapseBtn.focus()));
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = prefs.w;
    el.classList.add('ax-dragging');
    const move = (ev: PointerEvent) => ((prefs.w = clampW(w0 + ev.clientX - x0)), paintLayout());
    const up = () => (el.classList.remove('ax-dragging'), window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up), save());
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  grip.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
    if (!d) return;
    e.preventDefault();
    prefs.w = clampW(prefs.w + d);
    save();
    paintLayout();
  });
  const drawer = (open: boolean, focusBack = true) => {
    el.classList.toggle('ax-open', open);
    drawerBtn.setAttribute('aria-expanded', String(open));
    if (open) (tree.el.querySelector<HTMLElement>('[tabindex="0"]') ?? search).focus();
    else if (focusBack) drawerBtn.focus();
  };
  drawerBtn.addEventListener('click', () => drawer(!el.classList.contains('ax-open')));
  scrim.addEventListener('click', () => drawer(false));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.classList.contains('ax-open')) {
      e.preventDefault();
      drawer(false);
    }
  });
  const phone = () => window.matchMedia?.('(max-width: 760px)').matches ?? false;

  allBox.addEventListener('change', () => {
    prefs.all = allBox.checked;
    save();
    selected = undefined;
    tree.selectedId = undefined;
    tree.query = prefs.all ? '' : search.value;
    tree.setModel(model());
    paintLayout();
    void loadRoots().then(() => refreshOpen(prefs.all ? files : biz, false)).then(() => runSearch());
  });
  // Keys typed in one frame are one search (no timer: the next frame draws it).
  let searchFrame = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => void runSearch());
  });

  /** The search: in the business view every level is loaded once (folded groups too); in all files the server looks through every file. */
  async function runSearch() {
    const q = search.value.trim();
    if (prefs.all) {
      tree.query = '';
      tree.setModel(model());
      if (!q || !floor || !rev) return say(''), draw();
      const f = floor;
      const r = rev;
      const res = await api.search(f, r, q).catch(() => undefined);
      if (f !== floor || r !== rev || q !== search.value.trim()) return;
      found.roots = res?.nodes ?? [];
      say(!res ? 'The search couldn’t run just now.' : res.total > res.nodes.length ? `${res.total} files match; the first ${res.nodes.length} are shown. Add a word to narrow it.` : res.total ? `${res.total} file${res.total === 1 ? '' : 's'} match.` : 'No file of this revision matches.');
      return draw();
    }
    tree.query = search.value;
    if (q) await loadIndex();
    draw();
  }

  // ---- Loading levels ----------------------------------------------------------------------------------
  const levelKey = (n: ExplorerNode) => (n.kind === 'folder' && n.path !== undefined ? n.path : n.id);

  async function fetchLevel(m: TreeModel, id: string, at: string, keepOld = false) {
    const f = floor;
    const r = rev;
    const g = gen;
    if (!f || !r) return;
    const old = m.kids.get(id);
    if (!keepOld || !old) m.kids.set(id, { nodes: [], loading: true });
    try {
      const lv = m === files ? await api.folder(f, r, at) : await api.level(f, r, at);
      if (g !== gen || r !== rev) return;
      m.kids.set(id, { nodes: lv.nodes, ...(lv.next !== undefined ? { next: lv.next, total: lv.total } : {}), ...(lv.note || lv.problem ? { note: lv.problem ?? lv.note } : {}) });
    } catch {
      if (g !== gen) return;
      m.kids.set(id, { nodes: [], error: 'This couldn’t be read just now.' });
    }
  }

  async function expand(n: ExplorerNode) {
    const m = model();
    if (isDocs(n.id) || m === found) return;
    if (m.kids.get(n.id) && !m.kids.get(n.id)!.error) return;
    draw();
    await fetchLevel(m, n.id, levelKey(n));
    draw();
  }

  async function more(parent: string, cursor: number) {
    const f = floor;
    const r = rev;
    const lv = files.kids.get(parent);
    if (!f || !r || !lv) return;
    const path = parent ? parent.slice(2, -1) : '';
    const next = await api.folder(f, r, path, cursor).catch(() => undefined);
    if (!next || r !== rev) return;
    files.kids.set(parent, { nodes: [...lv.nodes, ...next.nodes], ...(next.next !== undefined ? { next: next.next, total: next.total } : {}) });
    if (parent === '') files.roots = files.kids.get('')!.nodes;
    draw();
  }

  /** Every level of the business tree at this revision, in one request (kept: the revision never changes). */
  /** Every level at this revision (kept: the search and the first page share one request). */
  let levels: Record<string, ExplorerNode[]> | undefined;
  async function loadIndex(): Promise<Record<string, ExplorerNode[]> | undefined> {
    const f = floor;
    const r = rev;
    if (!f || !r || indexed === r) return indexed === r ? levels : undefined;
    const ix = await api.index(f, r).catch(() => undefined);
    if (!ix || f !== floor || r !== rev) return undefined;
    if (ix.problem) return void say(ix.problem);
    indexed = r;
    levels = ix.levels;
    for (const [at, nodes] of Object.entries(ix.levels)) if (at !== '' && !biz.kids.get(at)?.nodes.length) biz.kids.set(at, { nodes });
    return levels;
  }

  async function loadRoots() {
    const f = floor;
    const g = gen;
    if (!f) return;
    if (!rev) {
      say(headError ?? (head ? 'The project has no commits yet, so there’s nothing to explore.' : 'Finding main’s newest commit…'));
      biz.roots = docGroups(docsView, biz, false);
      return draw();
    }
    if (prefs.all) {
      await fetchLevel(files, '', '');
      if (g !== gen) return;
      files.roots = files.kids.get('')?.nodes ?? [];
      const lv = files.kids.get('');
      say(lv?.error ?? (lv?.next !== undefined ? 'A big folder: its first rows are shown, with Show more below.' : ''));
    } else {
      await fetchLevel(biz, '', '');
      if (g !== gen) return;
      const top = biz.kids.get('');
      biz.roots = [...(top?.nodes ?? []), ...docGroups(docsView, biz, true)];
      say(top?.error ?? top?.note ?? '');
    }
    draw();
  }

  function loadDocs() {
    const f = floor;
    const r = rev;
    if (!f || !r) return;
    void api
      .documents(f, r)
      .catch(() => undefined)
      .then((v) => {
        if (floor !== f || rev !== r) return;
        docsView = v ?? { rev: r, entries: [], counts: { version: 0, alternative: 0, supporting: 0, related: 0, run: 0, unknown: 0, files: 0, entries: 0 }, problem: 'The documents couldn’t be read just now.' };
        if (!prefs.all) {
          biz.roots = [...biz.roots.filter((n) => !isDocs(n.id)), ...docGroups(docsView, biz, false)];
          draw();
        }
      });
  }

  // ---- Opening ------------------------------------------------------------------------------------------
  function openEntry(id: string) {
    const e = docsView?.entries.find((x) => x.id === id);
    if (!e || !docsView) return;
    opened = undefined;
    pane.showDoc(e, docsView);
    deps.pane(true);
  }

  function openNode(n: ExplorerNode) {
    const f = floor;
    if (!f) return;
    if (n.kind === 'doc' && n.id.startsWith(DOC_PREFIX)) {
      openEntry(n.id.slice(DOC_PREFIX.length));
    } else {
      // A page opens its Model preview (never the live app's frame); data, logic and files their views.
      opened = undefined;
      pane.show(n, n.type === 'page' ? `${n.label} · Model preview` : n.kind === 'file' ? n.path : n.label);
      deps.pane(true);
    }
    if (phone()) drawer(false, false);
  }

  /** Open in the live app: the explicit, separate way to see a page running. */
  function openLive(n: ExplorerNode) {
    if (!n.url || !deps.data().appUrl) return;
    opened = { path: n.url, ...(n.key ? { key: n.key } : {}) };
    deps.pane(false);
    deps.go(n.url);
    if (phone()) drawer(false, false);
  }

  function backToApp() {
    deps.pane(false);
    tree.focusRow(tree.selectedId);
  }

  function drawBar() {
    const n = selected;
    if (!n || n.kind === 'group' || (n.kind === 'module' && n.type !== 'domainmodel') || n.kind === 'folder') return void bar.replaceChildren();
    const f = floor;
    const about = aboutOf(n);
    const ask = h('button.aw-btn.ax-ask', { type: 'button', onclick: () => askAbout(n) }, 'Request a change');
    const d = deps.data();
    const live = n.type === 'page' && n.url
      ? h('button.aw-btn.ax-live-open', { type: 'button', disabled: !d.appUrl, title: d.appUrl ? `Opens ${n.url} in the running app` : 'The app isn’t running, so it can’t be opened live. The Model preview works without it.', onclick: () => openLive(n) }, 'Open in the live app')
      : '';
    const canChange = d.admin && !!f && !!n.qn && !!n.type && CHANGE_KINDS.has(n.type);
    const change = canChange
      ? h('button.aw-btn.ax-change', {
          type: 'button',
          title: 'Ask the team to change this, through the same path as in Project Management',
          onclick: (e: Event) => {
            const btn = e.currentTarget as HTMLElement;
            const o = { floor: f!, ref: head?.branch.replace(/^origin\//, '') ?? 'main', ...(rev ? { sha: rev } : {}), kind: n.type!, qn: n.qn!, back: () => btn.focus() };
            if (deps.changeThis) return deps.changeThis(o);
            void import('../../model/change-this').then(({ openChangeThis }) => openChangeThis({ floor: o.floor, ref: o.ref, ...(o.sha ? { sha: o.sha } : {}), elements: [{ kind: o.kind as 'page', qn: o.qn }], back: o.back }));
          },
        }, 'Change this')
      : '';
    bar.replaceChildren(h('div.ax-bar-name', { title: n.hint ?? '' }, about), n.detail && n.kind !== 'doc' ? h('div.ax-bar-detail', {}, n.detail) : '', h('div.ax-bar-acts', {}, live, ask, change));
  }

  /** Request a change about a row: a page carries its model reference (the widget picked on its preview, when that page is open) and the revision viewed. */
  function askAbout(n: ExplorerNode, at?: { element: ElementContext; rev: string }) {
    const about = aboutOf(n);
    const open = pane.node?.id === n.id && !pane.el.hidden ? pane.element() : undefined;
    const element = at?.element ?? open ?? (n.type === 'page' && n.qn ? { ref: { docType: 'page' as const, docQn: n.qn, label: n.label }, chip: n.label, where: `page ${n.qn}` } : undefined);
    const viewed = at?.rev || rev;
    const words = viewed && viewed === head?.rev ? `main @${viewed.slice(0, 7)}` : viewed && viewed === served ? `the live app’s revision @${viewed.slice(0, 7)}` : viewed ? `revision @${viewed.slice(0, 7)}` : undefined;
    deps.request(about, n.type === 'page' ? n.url : undefined, element && viewed ? { element, rev: viewed, ...(words ? { words } : {}) } : undefined);
  }

  function say(s: string) {
    status.textContent = s;
    status.hidden = !s;
  }

  function draw() {
    tree.draw();
    paintRev();
    paintRail();
  }
  function paintRev() {
    revLine.paint({ head, rev, served, running: !!deps.data().appUrl, onServed, ...(headError ? { error: headError } : {}) });
  }

  // ---- Following the project and main's newest commit ------------------------------------------------------
  function reset() {
    gen++;
    for (const m of [biz, files, found]) {
      m.roots = [];
      m.kids.clear();
      m.expanded.clear();
      m.dots.clear();
    }
    head = undefined;
    headError = undefined;
    rev = undefined;
    onServed = false;
    docsView = undefined;
    indexed = undefined;
    opened = undefined;
    selected = undefined;
    tree.selectedId = undefined;
    drawBar();
  }

  /** Asks for main's newest commit: the first answer sets the revision; later ones only mark the tree stale. */
  async function askHead() {
    const f = floor;
    if (!f) return;
    const h0 = await api.head(f, served).catch((err: Error) => ((headError = `Couldn’t find main’s newest commit: ${err.message}`), undefined));
    if (f !== floor) return;
    if (h0) {
      head = h0;
      headError = undefined;
    }
    if (!rev && !onServed && head?.rev) await toRev(head.rev);
    else if (!rev) await loadRoots();
    draw();
  }

  function pick(which: 'main' | 'served') {
    onServed = which === 'served' && !!served;
    void toRev(onServed ? served : head?.rev);
  }

  /** Reads another revision: the open levels again at it, the changed rows marked. */
  async function toRev(next: string | undefined) {
    if (!next || next === rev) return draw();
    const prev = rev;
    rev = next;
    gen++;
    const g = gen;
    indexed = undefined;
    docsView = undefined;
    for (const m of [biz, files]) {
      m.dots.clear();
      // The view not on screen reads its open parts again when it's switched to; the one on screen keeps its rows until the new ones come.
      for (const id of [...m.kids.keys()]) if (!isDocs(id) && (m !== (prefs.all ? files : biz) || (!m.expanded.has(id) && id !== ''))) m.kids.delete(id);
    }
    loadDocs();
    await loadRoots();
    if (g !== gen) return;
    if (wantFirst) void openFirst();
    await refreshOpen(prefs.all ? files : biz, true);
    if (g !== gen) return;
    if (search.value.trim()) await runSearch();
    draw();
    if (!prev || !floor) return;
    const ch = await api.changes(floor, prev, next).catch(() => undefined);
    if (!ch || g !== gen) return;
    markDots(biz, files, ch);
    draw();
    // A page open live in the canvas that changed: opened again (the live app reloads it at its own pace).
    const at = deps.where();
    if (opened && at && !at.moved && ch.docs.includes(opened.key ?? '')) deps.go(opened.path);
  }

  /** The open parts of a view, read (again) at the revision on screen. */
  function refreshOpen(m: TreeModel, keepOld: boolean) {
    return Promise.all([...m.expanded].filter((id) => !isDocs(id) && (keepOld || !m.kids.get(id))).map((id) => fetchLevel(m, id, m === files ? id.slice(2, -1) : id, keepOld)));
  }

  const onFocus = () => {
    if (floor && document.visibilityState !== 'hidden') void askHead();
  };
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);

  /** The app's first page in the Model preview, once per revision, while nothing is open. */
  let firstFor: string | undefined;
  let wantFirst = false;
  async function openFirst() {
    const f = floor;
    const r = rev;
    wantFirst = !r;
    if (!f || !r || pane.node || firstFor === r) return;
    firstFor = r;
    const all = await loadIndex();
    if (!all || f !== floor || r !== rev || pane.node) return;
    const n = firstPage(all);
    if (!n) return;
    selected = n;
    tree.selectedId = n.id;
    drawBar();
    openNode(n);
  }

  paintLayout();
  return {
    el,
    pane,
    openFirst: () => void openFirst(),
    update(d) {
      const s = servedOf(d);
      if (d.floor !== floor) {
        reset();
        floor = d.floor;
        served = s;
        if (floor) void askHead();
        return;
      }
      if (s !== served) {
        served = s;
        // The live app moved (a hot reload, a restart): main may have too. Reading follows only when the viewer reads the live app's revision.
        if (onServed && s) void toRev(s);
        void askHead();
      }
      // Admin can change while it shows: the bar's Change this follows.
      if (d.admin !== admin) {
        admin = d.admin;
        if (selected) drawBar();
      }
      paintRev();
    },
  };
}
