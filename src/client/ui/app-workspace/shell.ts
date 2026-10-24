// The Developer view's shell (the code's App Workspace): explorer | canvas | the coordinator chat, docked on the
// right. While it shows, the page is the workspace's: Project Management's navigation, page header and progress
// line step aside (body.aw-on, ./app-workspace.css), the team-lead panel docks beside the canvas as the view's
// chat (./dock/), and the address carries &ws=app. The Developer | Project Management switch is the top bar's
// (./view-switch.ts), the same on every page. Its parts:
//
//   bar       the project's name and the canvas's two views: Model preview (the default) and Live preview
//   explorer  the left sidebar (./explorer/: the app's pages, data, logic and documents, or all the project's
//             files), loaded with the first show
//   canvas    Model preview: the page opened in the explorer, drawn from the model at the revision viewed (the
//             app's first page until one is picked), so nothing on the default path needs the live app.
//             Live preview: the running app (./canvas.ts), "not running" with where to start it otherwise, and
//             the guided checks of the running version under it (./validation.ts: Try it, the person's marks)
//   chat      the team-lead panel, docked (./dock/): its header (status, revisions, this session's changes),
//             the conversation with each change's receipt, decisions and "Please try this" cards, and the
//             composer with the selection as a chip; "Request a change to this" anywhere focuses it
//
// The old Requirements, Decisions, Review and Release sections and the status panel are gone from here: their
// lists are Project Management's (Documents, Approvals, Testing, the Overview's progress and Accept). Every action
// is a link to what the office already does, with that page's own checks: the workspace adds no permission.

import { store } from '../../state';
import { h, toast } from '../dom';
import { openRequestDialog, sentWords } from './requests';
import { setAddress } from '../../shared/address';
import { currentProjectTab, openProjectTab } from '../../tabs/host';
import type { TabHooks } from '../../tabs/registry';
import { DEVELOPER_VIEW, isAppSection } from '../../../shared/app-workspace/route';
import { workspaceStage, type WorkspaceStage } from '../../../shared/app-workspace/words';
import { pageSource, type WorkspaceData, type WorkspaceSource } from './data';
import { workspaceCanvas } from './canvas';
import { validationPart } from './validation';
import { previewOff } from '../../../shared/liveapp/not-running';
import { createDock, type Dock } from './dock';
import type { DevContext } from './dock/logic';
import './app-workspace.css';
// Only its types here: the explorer comes in with the first show.
import type { Explorer, ExplorerDeps } from './explorer';

export interface WorkspaceDeps {
  source: WorkspaceSource;
  /** Shows a tab of the page (a Project Management page) the way the page does. */
  open(tab: string): void;
  /** Tests: the explorer's requests and openers. */
  explorer?: Partial<ExplorerDeps>;
}

export interface Workspace {
  readonly el: HTMLElement;
  show(): void;
  hide(): void;
  refresh(): void;
  /** Whether it's on screen. */
  shown(): boolean;
  /** The canvas's view now. */
  view(): CanvasView;
  readonly dock: Dock;
}

export type CanvasView = 'model' | 'live';

/** The stage of the data, as the canvas reads it. */
export const stageOf = (d: WorkspaceData): WorkspaceStage => workspaceStage({ business: d.business?.state, toolkit: d.progress?.toolkit, phase: d.progress?.phase });

/** Builds the workspace (the page's own, or a test's with its own source and opener). */
export function createWorkspace(deps: WorkspaceDeps): Workspace {
  let visible = false;
  let view: CanvasView = 'model';
  const crumb = h('span.aw-crumb');
  const viewTab = (v: CanvasView, label: string) => h('button.aw-tab', { type: 'button', role: 'tab', 'data-view': v, 'aria-controls': 'aw-canvas', onclick: () => setView(v, true) }, label);
  const modelTab = viewTab('model', 'Model preview');
  const liveTab = viewTab('live', 'Live preview');
  const liveDot = h('span.aw-livedot', { 'aria-hidden': 'true' });
  liveTab.append(liveDot);
  const tabs = h('nav.aw-tabs.aw-views', { role: 'tablist', 'aria-label': 'Canvas' }, modelTab, liveTab);
  const bar = h('div.aw-bar', {}, h('div.aw-bar-top', {}, crumb, h('span.aw-grow'), tabs));
  const canvas = workspaceCanvas({ open: deps.open });
  const dock = createDock({ source: deps.source, open: deps.open, live: () => setView('live', true), me: () => store.me.account?.name ?? store.profile.name });
  /** "Request a change to this": the docked composer with the context; the old dialog only where there's no chat. */
  const request = (c: DevContext | undefined, dialog: Parameters<typeof openRequestDialog>[0]) => {
    if (dock.focus(c)) return;
    openRequestDialog(dialog, (a) => deps.source.request(a), (r) => toast(sentWords(r)));
  };
  const validation = h('section.aw-card.aw-guided', { hidden: true }, h('h3', {}, 'Guided checks on this version'));
  const validBody = h('div');
  validation.append(validBody);
  const liveBox = h('div.aw-livebox', {}, canvas.el, validation);
  const modelNote = h('div.aw-canvas-empty.aw-modelnote');
  const main = h('div.aw-main', { id: 'aw-canvas', role: 'tabpanel' });
  const xslot = h('div.aw-xslot', { hidden: true });
  const body = h('div.aw-body', {}, xslot, main);
  const el = h('section.aw', { 'aria-label': DEVELOPER_VIEW, hidden: true }, bar, body);
  let explorer: Explorer | undefined;
  let explorerAsked = false;
  let pendingGo: string | undefined;

  function setView(v: CanvasView, user = false) {
    view = v;
    if (v === 'model' && explorer && !explorer.pane.node) explorer.openFirst();
    draw();
    if (user && v === 'live') liveTab.focus();
  }
  const loadExplorer = () => {
    if (explorerAsked) return;
    explorerAsked = true;
    void import('./explorer').then(({ createExplorer }) => {
      explorer = createExplorer({
        data: () => deps.source.get(),
        go: (p) => canvas.go(p),
        where: () => canvas.where(),
        pane: (on) => setView(on ? 'model' : 'live'),
        selection: (s) => dock.select(s),
        request: (about, page, at) => {
          const d = deps.source.get();
          const revision = d.appUrl ? d.live?.served?.sha : undefined;
          const model = at ? { element: at.element, source: at.rev, ...(at.words ? { sourceWords: at.words } : {}) } : {};
          request({ about, ...(at ? { element: at.element, rev: at.rev } : {}), ...(page ? { page } : {}) }, { ...(d.project ? { project: d.project } : {}), about, ...(page ? { page } : {}), ...(revision ? { revision } : {}), ...model });
        },
        ...deps.explorer,
      });
      xslot.replaceChildren(explorer.el);
      draw();
    });
  };

  function draw() {
    if (!visible) return;
    const d = deps.source.get();
    crumb.textContent = d.project ? `${d.project} · ${DEVELOPER_VIEW}` : DEVELOPER_VIEW;
    for (const t of [modelTab, liveTab]) t.setAttribute('aria-selected', String(t.dataset.view === view));
    liveDot.className = `aw-livedot ${d.appUrl ? 'on' : ''}`;
    // Why it isn't showing the app, when it isn't: a failed build with its commit and reason, never a bare "not running" (shared/liveapp/not-running.ts).
    const off = d.appUrl ? undefined : previewOff(d.live);
    liveTab.title = off ? `${off.line} The Model preview works without it.` : 'The running app';
    liveTab.firstChild!.textContent = off ? `Live preview · ${off.short}` : 'Live preview';
    liveTab.classList.toggle('aw-tab-bad', !!off && (off.kind === 'failed' || off.kind === 'crashed' || off.kind === 'timeout'));
    xslot.hidden = !explorer;
    body.classList.toggle('ax-has', !xslot.hidden);
    loadExplorer();
    explorer?.update(d);
    if (pendingGo && d.appUrl) {
      view = 'live';
      canvas.go(pendingGo);
      pendingGo = undefined;
    }
    canvas.draw(d, stageOf(d));
    canvas.el.hidden = view !== 'live';
    if (explorer) explorer.pane.el.hidden = view !== 'model' || !explorer.pane.node;
    const parts: HTMLElement[] = [liveBox, ...(explorer ? [explorer.pane.el] : []), modelNote];
    if (main.childNodes.length !== parts.length || parts.some((p, i) => main.childNodes[i] !== p)) main.replaceChildren(...parts);
    liveBox.hidden = view !== 'live';
    const empty = view === 'model' && !explorer?.pane.node;
    modelNote.hidden = !empty;
    if (empty) {
      modelNote.replaceChildren(h('h3', {}, 'Model preview'), h('p.aw-muted', {}, explorer ? 'Pick a page in the explorer to see it here, drawn from the model: the app doesn’t need to run. The app’s first page opens here by itself when there is one.' : 'Reading the app…'));
      explorer?.openFirst();
    }
    // The guided checks of the version running (C5): under the live preview, asked only while it shows.
    validation.hidden = view !== 'live' || !d.onScreen;
    if (view === 'live' && d.onScreen) {
      deps.source.want?.('validation');
      validBody.replaceChildren(validationPart(d.validation, d.onScreen, d.dev?.changes, { tryIt, where: () => canvas.where(), ...(deps.source.mark ? { mark: (m) => deps.source.mark!(m) } : {}), done: (t) => toast(t) }));
    }
    dock.draw(d);
  }
  /** A guided check's Try it: the live preview, at the check's start page where it names one. */
  function tryIt(path?: string) {
    view = 'live';
    if (path) pendingGo = path;
    draw();
  }

  deps.source.on(draw);
  return {
    el,
    dock,
    view: () => view,
    show() {
      if (!visible) {
        visible = true;
        el.hidden = false;
        document.body.classList.add('aw-on');
        deps.source.wake();
        dock.attach(true);
      }
      draw();
    },
    hide() {
      visible = false;
      el.hidden = true;
      canvas.idle();
      dock.attach(false);
      document.body.classList.remove('aw-on');
    },
    refresh: () => (deps.source.wake(), draw()),
    shown: () => visible,
  };
}

let ws: Workspace | undefined;

/** The page's workspace for its tab container (./tab.ts): one workspace, put beside the container. */
export function appWorkspace(container: HTMLElement): TabHooks {
  if (!ws) {
    const made = createWorkspace({ source: pageSource(), open: (t) => void openProjectTab(t) });
    ws = made;
    container.before(made.el);
    // Changing project while the workspace shows: the page goes to the new project's Overview first (its rule
    // for every page); the workspace takes the new project back to the Developer view.
    let floorWas = store.floor;
    store.on('floor', () => {
      const moved = !!floorWas && !!store.floor && floorWas !== store.floor;
      floorWas = store.floor;
      if (moved && made.shown() && !isAppSection(currentProjectTab())) openProjectTab('app');
    });
  }
  const w = ws;
  return {
    show() {
      w.show();
      setAddress({ ws: 'app' });
    },
    hide() {
      queueMicrotask(() => {
        if (isAppSection(currentProjectTab()) || !w.shown()) return;
        w.hide();
        setAddress({ ws: null });
      });
    },
    refresh: () => w.refresh(),
  };
}
