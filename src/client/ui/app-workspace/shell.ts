// The Developer view's shell (the code's App Workspace, C3 of the App Workspace proposal, section 5): one
// workspace the five section tabs share (./tab.ts), drawn once beside their containers. While a section
// shows, the page is the workspace's: Project Management's navigation, page header, team-lead panel and
// progress line step aside (body.aw-on, ./app-workspace.css), and the address carries &ws=app. The
// Developer | Project Management switch is the top bar's (./view-switch.ts), the same on every page. Its parts:
//
//   bar        the project's name, a small chip with its business status (C2, shared/business-status.ts),
//              the revision strip (ui/dev-changes/: main @M, the live preview @S, the active change's candidate @C)
//              and the section bar (App · Requirements · Decisions · Review · Release)
//   explorer   the App section's left sidebar (./explorer/: the app's pages, data, logic and documents, or all
//              the project's files), loaded with the App section's first show
//   main       the canvas (./canvas.ts: the running app) on App, a section's page (./sections.ts) on the rest;
//              a guided check's Try it (./validation.ts) shows the canvas at the check's start page
//   side       the side panel (./panel.ts): status bound to a version, the current request (./requests.ts),
//              the decision needed, progress, finished changes, the next action
//
// Every action is a link to what the office already does, with that page's own checks: the workspace adds
// no permission and no state.

import { store } from '../../state';
import { h, toast } from '../dom';
import { openRequestDialog, sentWords } from './requests';
import { revisionStrip } from '../dev-changes/view';
import { setAddress } from '../../shared/address';
import { currentProjectTab, openProjectTab } from '../../tabs/host';
import type { TabHooks } from '../../tabs/registry';
import { APP_SECTIONS, DEVELOPER_VIEW, isAppSection, type AppSection } from '../../../shared/app-workspace/route';
import { workspaceStage, type WorkspaceStage } from '../../../shared/app-workspace/words';
import { pageSource, type WorkspaceData, type WorkspaceSource } from './data';
import { workspaceCanvas } from './canvas';
import { sidePanel } from './panel';
import { sectionPage } from './sections';
import './app-workspace.css';
// Only its types here: the explorer comes in with the App section's first show.
import type { Explorer, ExplorerDeps } from './explorer';

export interface WorkspaceDeps {
  source: WorkspaceSource;
  /** Shows a tab of the page (an App section or an Engineering page) the way the page does. */
  open(tab: string): void;
  /** Tests: the explorer's requests and openers. */
  explorer?: Partial<ExplorerDeps>;
}

export interface Workspace {
  readonly el: HTMLElement;
  show(section: AppSection): void;
  /** Some section's tab hid: steps aside unless another section is showing now. */
  hide(): void;
  refresh(): void;
  /** Whether it's on screen. */
  shown(): boolean;
}

/** The stage of the data, as the canvas and the panel read it. */
export const stageOf = (d: WorkspaceData): WorkspaceStage => workspaceStage({ business: d.business?.state, toolkit: d.progress?.toolkit, phase: d.progress?.phase });

/** Builds the workspace (the page's own, or a test's with its own source and opener). */
export function createWorkspace(deps: WorkspaceDeps): Workspace {
  let section: AppSection = 'app';
  let visible = false;
  const crumb = h('span.aw-crumb');
  const chip = h('span.aw-pill.aw-statuschip', { hidden: true });
  const tabs = APP_SECTIONS.map((s) =>
    h('button.aw-tab', { type: 'button', 'data-section': s.id, title: s.hint, onclick: () => deps.open(s.id) }, s.label),
  );
  const strip = h('div.aw-strip');
  const bar = h('div.aw-bar', {}, h('div.aw-bar-top', {}, crumb, chip, strip), h('nav.aw-tabs', { 'aria-label': `${DEVELOPER_VIEW} sections` }, ...tabs));
  const canvas = workspaceCanvas({ open: deps.open });
  /** Request a change, about what's on screen: the project, the canvas's page and the running version. */
  const request = () => {
    const d = deps.source.get();
    const at = canvas.where();
    const revision = d.appUrl ? d.live?.served?.sha : undefined;
    openRequestDialog({ ...(d.project ? { project: d.project } : {}), ...(at ? { page: at.path, pageMoved: at.moved } : {}), ...(revision ? { revision } : {}) }, (a) => deps.source.request(a), (r) => toast(sentWords(r)));
  };
  /** A guided check's Try it: the App section, the canvas at the check's start page where it names one. */
  let pendingGo: string | undefined;
  const tryIt = (path?: string) => {
    pendingGo = path;
    deps.open('app');
  };
  const page = sectionPage({
    open: deps.open,
    answer: (x, a) => deps.source.answer(x, a),
    redraw: () => draw(),
    request,
    ...(deps.source.want ? { want: (w: 'validation' | 'delivery') => deps.source.want!(w) } : {}),
    validation: { tryIt, where: () => canvas.where(), ...(deps.source.mark ? { mark: (m) => deps.source.mark!(m) } : {}), done: (t) => toast(t) },
    release: { ...(deps.source.acceptance ? { acceptance: deps.source.acceptance } : {}), acted: () => deps.source.acted?.(), open: deps.open },
  });
  const main = h('div.aw-main');
  const panel = sidePanel({ open: deps.open, request });
  const xslot = h('div.aw-xslot', { hidden: true });
  const body = h('div.aw-body', {}, xslot, main, panel.el);
  const el = h('section.aw', { 'aria-label': DEVELOPER_VIEW, hidden: true }, bar, body);
  let explorer: Explorer | undefined;
  let explorerAsked = false;
  /** The explorer's pane or the running app, in the canvas's place. */
  const paneOn = (on: boolean) => {
    canvas.el.hidden = on;
    if (explorer) explorer.pane.el.hidden = !on;
  };
  const loadExplorer = () => {
    if (explorerAsked) return;
    explorerAsked = true;
    void import('./explorer').then(({ createExplorer }) => {
      explorer = createExplorer({
        data: () => deps.source.get(),
        go: (p) => canvas.go(p),
        where: () => canvas.where(),
        pane: paneOn,
        request: (about, page, at) => {
          const d = deps.source.get();
          const revision = d.appUrl ? d.live?.served?.sha : undefined;
          // From the explorer: the page or widget it points at in the model, and the revision viewed (never the live frame).
          const model = at ? { element: at.element, source: at.rev, ...(at.words ? { sourceWords: at.words } : {}) } : {};
          openRequestDialog({ ...(d.project ? { project: d.project } : {}), about, ...(page ? { page } : {}), ...(revision ? { revision } : {}), ...model }, (a) => deps.source.request(a), (r) => toast(sentWords(r)));
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
    const b = d.business;
    chip.hidden = !b;
    if (b) {
      chip.textContent = b.label;
      chip.className = `aw-pill aw-statuschip ${b.tone}`;
      chip.title = `Business status: ${b.line || b.label}`;
    }
    strip.replaceChildren(revisionStrip(d.dev));
    for (const t of tabs) {
      const on = t.dataset.section === section;
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    xslot.hidden = section !== 'app' || !explorer;
    body.classList.toggle('ax-has', !xslot.hidden);
    if (section === 'app') {
      const parts = explorer ? [canvas.el, explorer.pane.el] : [canvas.el];
      if (main.firstChild !== canvas.el || main.childNodes.length !== parts.length) main.replaceChildren(...parts);
      canvas.draw(d, stageOf(d));
      loadExplorer();
      explorer?.update(d);
      if (pendingGo) (paneOn(false), canvas.go(pendingGo));
      pendingGo = undefined;
    } else {
      if (main.firstChild !== page.el || main.childNodes.length !== 1) main.replaceChildren(page.el);
      page.draw(section, d);
    }
    panel.draw(d, stageOf(d), section);
  }

  deps.source.on(draw);
  return {
    el,
    show(s) {
      section = s;
      if (!visible) {
        visible = true;
        el.hidden = false;
        document.body.classList.add('aw-on');
        deps.source.wake();
      }
      draw();
    },
    hide() {
      visible = false;
      el.hidden = true;
      canvas.idle();
      document.body.classList.remove('aw-on');
    },
    refresh: () => (deps.source.wake(), draw()),
    shown: () => visible,
  };
}

let ws: Workspace | undefined;

/** The page's workspace for one section's tab container (./tab.ts): the one workspace, put beside the containers. */
export function appWorkspace(container: HTMLElement, id: AppSection): TabHooks {
  if (!ws) {
    const made = createWorkspace({ source: pageSource(), open: (t) => void openProjectTab(t) });
    ws = made;
    container.before(made.el);
    // Changing project while the workspace shows: the page goes to the new project's Overview first (its rule
    // for every page); the workspace takes the new project back to the section it was on.
    let floorWas = store.floor;
    store.on('floor', () => {
      const moved = !!floorWas && !!store.floor && floorWas !== store.floor;
      floorWas = store.floor;
      if (moved && made.shown() && !isAppSection(currentProjectTab())) openProjectTab(lastSection);
    });
  }
  const w = ws;
  return {
    show() {
      lastSection = id;
      w.show(id);
      setAddress({ ws: 'app' });
    },
    hide() {
      // Moving between sections hides one tab and shows another in the same showTab: wait for it to finish.
      queueMicrotask(() => {
        if (isAppSection(currentProjectTab()) || !w.shown()) return;
        w.hide();
        setAddress({ ws: null });
      });
    },
    refresh: () => w.refresh(),
  };
}

let lastSection: AppSection = 'app';
