// The App Workspace's shell (C3 of the App Workspace proposal, section 5): one workspace the five section
// tabs share (./tab.ts), drawn once beside their containers. While a section shows, the page is the
// workspace's: the Engineering view's navigation, page header, team-lead panel and progress line step
// aside (body.aw-on, ./app-workspace.css), and the address carries &ws=app. Its parts:
//
//   bar        the project's name, the section bar (App · Requirements · Decisions · Review · Release)
//              and the workspace switch (App view | Engineering view)
//   stages     the stage switch: where the project is (shared/app-workspace/words.ts workspaceStage, read
//              from the business status and the progress bar), and what each stage shows
//   main       the canvas (./canvas.ts: the running app) on App, a section's page (./sections.ts) on the rest;
//              a guided check's Try it (./validation.ts) shows the canvas at the check's start page
//   side       the side panel (./panel.ts): status bound to a version, the current request (./requests.ts),
//              the decision needed, progress, finished changes, the next action
//
// The switch keeps the project (the page and its connection stay; nothing reloads) and goes to the
// Engineering page you came from, or the one closest to this section. Every action is a link to what the
// office already does, with that page's own checks: the workspace adds no permission and no state.

import { store } from '../../state';
import { h, toast } from '../dom';
import { openRequestDialog } from './requests';
import { setAddress } from '../../shared/address';
import { currentProjectTab, openProjectTab } from '../../tabs/host';
import type { TabHooks } from '../../tabs/registry';
import { APP_SECTIONS, ENGINEERING_FOR, isAppSection, type AppSection } from '../../../shared/app-workspace/route';
import { shownStages, stageDef, workspaceStage, type WorkspaceStage } from '../../../shared/app-workspace/words';
import { pageSource, type WorkspaceData, type WorkspaceSource } from './data';
import { workspaceCanvas } from './canvas';
import { sidePanel } from './panel';
import { sectionPage } from './sections';
import './app-workspace.css';

export interface WorkspaceDeps {
  source: WorkspaceSource;
  /** Shows a tab of the page (an App section or an Engineering page) the way the page does. */
  open(tab: string): void;
  /** The Engineering tab showing before the workspace opened, if any. */
  cameFrom(): string | undefined;
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

/** The stage of the data, as the stage switch and the panel read it. */
export const stageOf = (d: WorkspaceData): WorkspaceStage => workspaceStage({ business: d.business?.state, toolkit: d.progress?.toolkit, phase: d.progress?.phase });

/** Builds the workspace (the page's own, or a test's with its own source and opener). */
export function createWorkspace(deps: WorkspaceDeps): Workspace {
  let section: AppSection = 'app';
  let visible = false;
  let peek: WorkspaceStage | undefined;
  const crumb = h('span.aw-crumb');
  const tabs = APP_SECTIONS.map((s) =>
    h('button.aw-tab', { type: 'button', 'data-section': s.id, title: s.hint, onclick: () => deps.open(s.id) }, s.label),
  );
  const appBtn = h('button.aw-seg', { type: 'button', 'aria-pressed': 'true', 'data-ws': 'app' }, 'App view');
  const engBtn = h('button.aw-seg', { type: 'button', 'aria-pressed': 'false', 'data-ws': 'eng', title: 'The same project with the team’s working pages: same records, same permissions', onclick: () => toEngineering() }, 'Engineering view');
  const bar = h(
    'div.aw-bar',
    {},
    h('div.aw-bar-top', {}, crumb, h('span.aw-grow'), h('div.aw-switch', { role: 'group', 'aria-label': 'Open this project in' }, appBtn, engBtn)),
    h('nav.aw-tabs', { 'aria-label': 'App workspace sections' }, ...tabs),
  );
  const stages = h('div.aw-stages', { role: 'group', 'aria-label': 'Stage' });
  const stageNote = h('div.aw-stagenote', { role: 'status', hidden: true });
  const canvas = workspaceCanvas({ open: deps.open });
  /** Request a change, about what's on screen: the project, the canvas's page and the running version. */
  const request = () => {
    const d = deps.source.get();
    const at = canvas.where();
    const revision = d.appUrl ? d.live?.served?.sha : undefined;
    openRequestDialog({ ...(d.project ? { project: d.project } : {}), ...(at ? { page: at.path, pageMoved: at.moved } : {}), ...(revision ? { revision } : {}) }, (a) => deps.source.request(a), (r) => toast(`Request ${r.id} sent to ${r.member}: it shows in the panel with its state`));
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
  const el = h('section.aw', { 'aria-label': 'App workspace', hidden: true }, bar, stages, stageNote, h('div.aw-body', {}, main, panel.el));

  function toEngineering() {
    const back = deps.cameFrom();
    deps.open(back && !isAppSection(back) ? back : ENGINEERING_FOR[section]);
  }

  function drawStages(d: WorkspaceData) {
    const now = stageOf(d);
    if (peek === now) peek = undefined;
    stages.replaceChildren(
      h('span.aw-stages-k', {}, 'Stage'),
      ...shownStages(now).map((s) =>
        h(
          'button.aw-stage',
          { type: 'button', 'data-stage': s.id, 'aria-pressed': String((peek ?? now) === s.id), class: s.id === now ? 'now' : '', title: s.id === now ? 'Where the project is now' : `What this page shows at ${s.label}`, onclick: () => ((peek = s.id === now ? undefined : s.id), draw()) },
          s.label,
          ...(s.id === now ? [h('span.aw-now', {}, 'Now')] : []),
        ),
      ),
    );
    if (!peek) {
      stageNote.hidden = true;
      return;
    }
    const p = stageDef(peek);
    const back = h('button.aw-link', { type: 'button', onclick: () => ((peek = undefined), draw()) }, `Back to ${stageDef(now).label}`);
    stageNote.hidden = false;
    stageNote.replaceChildren(
      h('b', {}, `${p.label}: `),
      `the page shows ${lower(p.canvas)}; the panel puts ${lower(p.panel)} first, and the next step is “${p.primary}”. This project is at ${stageDef(now).label}, so what you see below is its state now. `,
      back,
    );
  }

  function draw() {
    if (!visible) return;
    const d = deps.source.get();
    crumb.textContent = d.project ? `${d.project} · App workspace` : 'App workspace';
    for (const t of tabs) {
      const on = t.dataset.section === section;
      t.classList.toggle('on', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    }
    drawStages(d);
    if (section === 'app') {
      if (main.firstChild !== canvas.el || main.childNodes.length !== 1) main.replaceChildren(canvas.el);
      canvas.draw(d, stageOf(d));
      if (pendingGo) canvas.go(pendingGo);
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

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

let ws: Workspace | undefined;

/** The page's workspace for one section's tab container (./tab.ts): the one workspace, put beside the containers. */
export function appWorkspace(container: HTMLElement, id: AppSection, cameFrom: () => string | undefined): TabHooks {
  if (!ws) {
    const made = createWorkspace({ source: pageSource(), open: (t) => void openProjectTab(t), cameFrom });
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
