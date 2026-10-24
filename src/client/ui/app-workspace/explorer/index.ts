// The App Workspace's explorer: a sidebar on the left of the canvas, like a file explorer, loaded with the
// App section's first show (the shell imports it then). Two views of the same app, at the served revision
// (what runs, never a newer commit on its way):
//
//   business (default)  Pages, Data, Logic (server/app-explorer/: from the app's units at that revision),
//                       then Documents, Process map and Design (the Documents page's own list), in plain words
//   all files           "Show all files": the project's raw files at that revision, read-only, minus what the
//                       server never shows (shared/app-explorer.ts deniedPath, the .gitignore), file names
//                       as they are
//
// Opening a page with an address shows it running in the canvas (the Live app viewer's go); anything else
// opens in the pane (./pane.ts) with Back to the running app. The selected row's bar has Request a change
// (C4's dialog, with the item as context) and, for admins, Change this (the Model tab's dialog).
//
// Levels are fetched when first opened and kept per revision (./api.ts). Nothing polls: when the served
// revision changes (a hot reload or a restart: the live app's own message), the open levels are read again
// at the new revision, the rows that update changed get a dot, and a page open in the canvas that changed is
// opened again (the new revision already serves: served only moves once it answers).
//
// Width, collapsed and the switch are remembered per viewer (this browser). At a phone's width it's a
// drawer opened by a button. Keyboard and ARIA: ./tree.ts.

import { h } from '../../dom';
import type { DeliverablesView } from '../../../../shared/deliverables';
import { GROUPS, type ExplorerChanges, type ExplorerNode } from '../../../../shared/app-explorer';
import type { WorkspaceData } from '../data';
import { explorerApi, type ExplorerApi } from './api';
import { docPane, type Pane, type PaneDeps } from './pane';
import { TreeView, type Level, type TreeModel } from './tree';
import './explorer.css';

export const PREFS_KEY = 'agent-office.aw.explorer';
/** Set on the rows while "Show all files" is on: raw file names aren't held to the business words. */
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
  /** Opens a path of the app in the canvas (and the App section, if another shows). */
  go(path: string): void;
  /** Where the canvas is. */
  where(): { path: string; moved: boolean } | undefined;
  /** Shows the pane (true) or the running app (false) in the canvas's place. */
  pane(on: boolean): void;
  /** Request a change about an item ("Page: Visitor list"), with the page's path when it has one. */
  request(about: string, page?: string): void;
  /** Tests: the requests, the documents list, the document viewer, Change this, the Model tab's requests. */
  api?: ExplorerApi;
  docs?(floor: string): Promise<DeliverablesView | undefined>;
  openDoc?(floor: string, path: string, view?: DeliverablesView): void;
  changeThis?(o: { floor: string; ref: string; sha?: string; kind: string; qn: string; back: () => void }): void;
  model?: PaneDeps['api'];
}

export interface Explorer {
  readonly el: HTMLElement;
  readonly pane: Pane;
  /** The workspace drew: follow the project and the served revision. */
  update(d: WorkspaceData): void;
}

const CHANGE_KINDS = new Set(['page', 'microflow', 'nanoflow', 'entity']);
const revOf = (d: WorkspaceData) => d.live?.served?.sha ?? d.live?.lastServed?.sha;
const ABOUT: Record<string, string> = { page: 'Page', entity: 'Data', domainmodel: 'Data', microflow: 'Logic', nanoflow: 'Logic', doc: 'Document', file: 'File' };

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
  let floor: string | null = null;
  let rev: string | undefined;
  let docsView: DeliverablesView | undefined;
  let topNote = '';
  let opened: { path: string; key?: string } | undefined;
  let selected: ExplorerNode | undefined;
  let admin = false;
  let gen = 0;
  const model = () => (prefs.all ? files : biz);

  const tree = new TreeView(model(), { expand: (n) => void expand(n), open: (n) => openNode(n), select: (n) => ((selected = n ?? undefined), drawBar()), more: (p, c) => void more(p, c), changed: () => draw() }, 'The app');
  const pane = docPane({ floor: () => floor, rev: () => rev, back: () => backToApp(), file: (p) => api.file(floor!, rev!, p), ...(deps.model ? { api: deps.model } : {}) });

  const search = h('input.ax-search', { type: 'search', placeholder: 'Find…', 'aria-label': 'Find in the explorer' }) as HTMLInputElement;
  const allBox = h('input.ax-all', { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  const allLabel = h('label.ax-switch', { title: 'The project’s files as they are, read-only (for builders and IT)' }, allBox, h('span', {}, 'Show all files'));
  const collapseBtn = h('button.ax-icon.ax-collapse', { type: 'button', 'aria-label': 'Hide the explorer', title: 'Hide the explorer' }, '«');
  const expandBtn = h('button.ax-icon.ax-expand', { type: 'button', 'aria-label': 'Show the explorer', title: 'Show the explorer' }, '»');
  const heading = h('span.ax-title', {}, 'Explorer');
  const status = h('p.ax-status', { role: 'status' });
  const bar = h('div.ax-bar', { 'aria-live': 'polite' });
  const scroll = h('div.ax-scroll', {}, tree.el);
  const rows = h('div.ax-rows', {}, status, scroll, bar);
  const grip = h('div.ax-grip', { role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Explorer width', tabindex: '0', 'aria-valuemin': String(W_MIN), 'aria-valuemax': String(W_MAX) });
  const side = h('aside.ax-side', { id: 'ax-side', 'aria-label': 'Explorer' }, h('div.ax-head', {}, h('div.ax-headrow', {}, heading, h('span.aw-grow'), collapseBtn), search, allLabel), rows, expandBtn, grip);
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
    tree.setLabel(prefs.all ? 'The project’s files' : 'The app');
  }
  collapseBtn.addEventListener('click', () => ((prefs.collapsed = true), save(), paintLayout(), expandBtn.focus()));
  expandBtn.addEventListener('click', () => ((prefs.collapsed = false), save(), paintLayout(), collapseBtn.focus()));
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = prefs.w;
    const move = (ev: PointerEvent) => ((prefs.w = clampW(w0 + ev.clientX - x0)), paintLayout());
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up), save());
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
    tree.setModel(model());
    paintLayout();
    void loadRoots().then(() => refreshOpen(model(), false)).then(() => draw());
  });
  // Keys typed in one frame are one search (no timer: the next frame draws it).
  let searchFrame = 0;
  search.addEventListener('input', () => {
    cancelAnimationFrame(searchFrame);
    searchFrame = requestAnimationFrame(() => {
      tree.query = search.value;
      if (search.value.trim() && !prefs.all) void loadAllBusiness();
      draw();
    });
  });

  // ---- Loading levels ----------------------------------------------------------------------------------
  const levelKey = (n: ExplorerNode) => (n.kind === 'folder' ? n.path ?? '' : n.id);

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
      m.kids.set(id, { nodes: lv.nodes, ...(lv.next !== undefined ? { next: lv.next, total: lv.total } : {}), ...(lv.note ? { note: lv.note } : {}) });
    } catch (err) {
      if (g !== gen) return;
      m.kids.set(id, { nodes: [], error: 'This couldn’t be read just now.' });
    }
  }

  async function expand(n: ExplorerNode) {
    const m = model();
    if (n.id.startsWith('docs:')) return;
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

  /** The documents groups, from the Documents page's list (Process map and Design only when there are some). */
  function docGroups(): ExplorerNode[] {
    const groups = new Map<string, ExplorerNode[]>([['documents', []], ['processmap', []], ['design', []]]);
    for (const it of docsView?.items ?? []) {
      if (it.status === 'missing') continue;
      for (const file of it.files) {
        const g = file.processMap ? 'processmap' : it.team === 'design' ? 'design' : 'documents';
        const name = file.path.slice(file.path.lastIndexOf('/') + 1);
        groups.get(g)!.push({ id: `doc:${file.path}`, label: it.files.length > 1 ? `${it.title}: ${name}` : it.title, kind: 'doc', path: file.path, key: file.path, hint: file.path });
      }
    }
    const out: ExplorerNode[] = [];
    for (const def of GROUPS.filter((x) => groups.has(x.id))) {
      const nodes = groups.get(def.id)!.sort((a, b) => a.label.localeCompare(b.label));
      if (!nodes.length && def.id !== 'documents') continue;
      const id = `docs:${def.id}`;
      biz.kids.set(id, { nodes, ...(docsView ? {} : { loading: true }), note: 'No documents yet. The team’s documents show here once they’re written.' });
      out.push({ id, label: def.label, kind: 'group', hint: def.hint, folder: true, count: nodes.length });
    }
    return out;
  }

  async function loadRoots() {
    const f = floor;
    const g = gen;
    if (!f) return;
    if (prefs.all) {
      if (!rev) return say('The project’s files show here once the app has run.'), draw();
      await fetchLevel(files, '', '');
      if (g !== gen) return;
      files.roots = files.kids.get('')?.nodes ?? [];
      const lv = files.kids.get('');
      say(lv?.error ?? (lv?.next !== undefined ? 'A big folder: its first rows are shown, with Show more below.' : ''));
    } else {
      if (rev) {
        await fetchLevel(biz, '', '');
        if (g !== gen) return;
        topNote = biz.kids.get('')?.error ?? biz.kids.get('')?.note ?? '';
      } else topNote = 'The app’s pages, data and logic show here once it has run.';
      biz.roots = [...(biz.kids.get('')?.nodes ?? []), ...docGroups()];
      say(topNote);
    }
    draw();
  }

  /** A search in the business view: every part's rows, so a page in a closed part is found too. */
  async function loadAllBusiness() {
    const f = floor;
    if (!f || !rev) return;
    for (const top of biz.roots.filter((n) => !n.id.startsWith('docs:'))) {
      if (!biz.kids.get(top.id)?.nodes.length) await fetchLevel(biz, top.id, top.id);
      await Promise.all((biz.kids.get(top.id)?.nodes ?? []).filter((n) => n.folder && !biz.kids.get(n.id)?.nodes.length).map((n) => fetchLevel(biz, n.id, n.id)));
      draw();
    }
  }

  // ---- Opening ------------------------------------------------------------------------------------------
  function openNode(n: ExplorerNode) {
    const f = floor;
    if (!f) return;
    if (n.kind === 'doc' && n.path) {
      if (deps.openDoc) deps.openDoc(f, n.path, docsView);
      else void import('../../deliverables/viewer').then(({ openDeliverable }) => {
        const file = docsView?.items.flatMap((i) => i.files).find((x) => x.path === n.path);
        if (file) openDeliverable(f, file, docsView);
      });
      return;
    }
    const d = deps.data();
    if (n.type === 'page' && n.url && d.appUrl) {
      opened = { path: n.url, ...(n.key ? { key: n.key } : {}) };
      deps.pane(false);
      deps.go(n.url);
    } else {
      opened = undefined;
      const why = n.type === 'page' && n.url ? `The app isn’t running right now, so this is a preview with sample data. Once it runs, this page opens at ${n.url}.` : undefined;
      pane.show(n, n.kind === 'file' ? n.path : n.label, why);
      deps.pane(true);
    }
    if (phone()) drawer(false, false);
  }

  function backToApp() {
    deps.pane(false);
    tree.focusRow(tree.selectedId);
  }

  function drawBar() {
    const n = selected;
    if (!n || n.kind === 'group' || n.kind === 'module' && n.type !== 'domainmodel' || n.kind === 'folder') return void bar.replaceChildren();
    const f = floor;
    const kind = n.kind === 'doc' ? 'doc' : n.kind === 'file' ? 'file' : n.type ?? '';
    const about = `${ABOUT[kind] ?? 'Item'}: ${n.kind === 'file' ? n.path : n.label}`;
    const ask = h('button.aw-btn.ax-ask', { type: 'button', onclick: () => deps.request(about, n.type === 'page' ? n.url : undefined) }, 'Request a change');
    const d = deps.data();
    const canChange = d.admin && !!f && !!n.qn && !!n.type && CHANGE_KINDS.has(n.type);
    const change = canChange
      ? h('button.aw-btn.ax-change', {
          type: 'button',
          title: 'Ask the team to change this, through the same path as in Project Management',
          onclick: (e: Event) => {
            const btn = e.currentTarget as HTMLElement;
            const o = { floor: f!, ref: d.live?.branch ?? 'main', ...(rev ? { sha: rev } : {}), kind: n.type!, qn: n.qn!, back: () => btn.focus() };
            if (deps.changeThis) return deps.changeThis(o);
            void import('../../model/change-this').then(({ openChangeThis }) => openChangeThis({ floor: o.floor, ref: o.ref, ...(o.sha ? { sha: o.sha } : {}), elements: [{ kind: o.kind as 'page', qn: o.qn }], back: o.back }));
          },
        }, 'Change this')
      : '';
    bar.replaceChildren(h('div.ax-bar-name', { title: n.hint ?? '' }, about), h('div.ax-bar-acts', {}, ask, change));
  }

  function say(s: string) {
    status.textContent = s;
    status.hidden = !s;
  }

  function draw() {
    tree.draw();
  }

  // ---- Following the project and the served revision -------------------------------------------------------
  function reset() {
    gen++;
    for (const m of [biz, files]) {
      m.roots = [];
      m.kids.clear();
      m.expanded.clear();
      m.dots.clear();
    }
    docsView = undefined;
    opened = undefined;
    selected = undefined;
    tree.selectedId = undefined;
    drawBar();
  }

  function loadDocs(f: string) {
    const load = deps.docs ?? ((fl: string) => import('../../deliverables/store').then((s) => s.loadDocs(fl)));
    void load(f).then((v) => {
      if (floor !== f) return;
      docsView = v ?? { floor: f, scannedAt: 0, items: [], sources: [] };
      if (!prefs.all) {
        biz.roots = [...biz.roots.filter((n) => !n.id.startsWith('docs:')), ...docGroups()];
        draw();
      }
    });
  }

  /** The served revision moved: the open levels again at the new one, the changed rows marked, the canvas's page again. */
  async function moved(prev: string | undefined) {
    gen++;
    const g = gen;
    for (const m of [biz, files]) {
      m.dots.clear();
      // The view not on screen reads its open parts again when it's switched to; the one on screen keeps its rows until the new ones come.
      for (const id of [...m.kids.keys()]) if (!id.startsWith('docs:') && (m !== model() || (!m.expanded.has(id) && id !== ''))) m.kids.delete(id);
    }
    await loadRoots();
    if (g !== gen) return;
    await refreshOpen(model(), true);
    if (g !== gen) return;
    draw();
    if (!prev || !floor || !rev) return;
    const ch = await api.changes(floor, prev, rev).catch(() => undefined);
    if (!ch || g !== gen) return;
    markDots(ch);
    draw();
    // The page open in the canvas: opened again when it changed (a reload at the new revision), or when the
    // viewer went back to the app's home on the new revision while it showed that page.
    const at = deps.where();
    if (opened && at && !at.moved && (ch.docs.includes(opened.key ?? '') || at.path !== opened.path)) {
      deps.go(opened.path);
      say(ch.docs.includes(opened.key ?? '') ? 'The page on screen changed in the last update, so it was opened again.' : '');
    }
  }

  /** The open parts of a view, read (again) at the revision on screen. */
  function refreshOpen(m: TreeModel, keepOld: boolean) {
    return Promise.all([...m.expanded].filter((id) => !id.startsWith('docs:') && (keepOld || !m.kids.get(id))).map((id) => fetchLevel(m, id, m === files ? id.slice(2, -1) : id, keepOld)));
  }

  function markDots(ch: ExplorerChanges) {
    const GROUP: Record<string, string> = { page: 'pages', microflow: 'logic', nanoflow: 'logic', domainmodel: 'data' };
    for (const key of ch.docs) {
      const kind = key.slice(0, key.indexOf(':'));
      const qn = key.slice(kind.length + 1);
      const group = GROUP[kind];
      if (!group) continue;
      const module = kind === 'domainmodel' ? qn : qn.slice(0, qn.indexOf('.'));
      biz.dots.add(group).add(`${group}/${module}`);
      if (kind !== 'domainmodel') biz.dots.add(key);
      else for (const n of biz.kids.get(`data/${module}`)?.nodes ?? []) biz.dots.add(n.id);
    }
    for (const p of ch.files) {
      files.dots.add(`f:${p}`);
      const parts = p.split('/');
      for (let i = 1; i < parts.length; i++) files.dots.add(`f:${parts.slice(0, i).join('/')}/`);
      for (const n of [...(biz.kids.values())].flatMap((l) => l.nodes)) if (n.kind === 'doc' && n.path === p) biz.dots.add(n.id).add(`docs:${biz.roots.find((r) => biz.kids.get(r.id)?.nodes.includes(n))?.id.slice(5) ?? 'documents'}`);
    }
  }

  paintLayout();
  return {
    el,
    pane,
    update(d) {
      const r = revOf(d);
      if (d.floor !== floor) {
        reset();
        floor = d.floor;
        rev = r;
        if (floor) {
          loadDocs(floor);
          void loadRoots();
        }
        return;
      }
      if (r && r !== rev) {
        const prev = rev;
        rev = r;
        void moved(prev);
      }
      // Admin can change while it shows: the bar's Change this follows.
      if (d.admin !== admin) {
        admin = d.admin;
        if (selected) drawBar();
      }
    },
  };
}
