// The view switch, **Developer | Project Management**: one control at the top right of every project page
// of the 1D view, in the page's top bar (.lite-bar, right after Go to Office), so it stands in the same place,
// at the same size, on every Project Management tab and in the Developer view, in Portal Light/Dark, the
// classic themes and at phone width (where it says Dev | PM). Developer is the code's app workspace (the five
// section tabs, ./tab.ts and ./shell.ts); Project Management is every other tab and the navigation. It only
// opens tabs the way the page does (tabs/host.ts openProjectTab): the project and the page stay (nothing
// reloads, the running app's version with them), and the address follows (&ws=app while the Developer view
// shows, shared/app-workspace/route.ts).
//
//   to Developer           the section closest to the page you're on (Approvals → Decisions, Documents →
//                          Requirements, anything else → App)
//   to Project Management  the page you came from, else the one closest to the section you're on
//
// Keys: Tab to it, then ← / → move between the two (and switch), like the console's Chat / Terminal toggle;
// the page has no page-wide shortcuts, so it never takes your typing.

import { h } from '../dom';
import { APP_SECTIONS, appSectionFor, ENGINEERING_FOR, isAppSection, VIEW_NAMES } from '../../../shared/app-workspace/route';
import './view-switch.css';

export interface ViewSwitchDeps {
  /** The tab the page shows now (undefined before it has shown one). */
  current(): string | undefined;
  /** Shows a tab the way the page does. */
  open(tab: string): void;
  /** The Project Management tab showing before the Developer view opened, if any. */
  cameFrom(): string | undefined;
}

export interface ViewSwitch {
  readonly el: HTMLElement;
  /** Marks the view showing now (after every tab change). */
  draw(): void;
}

const SHORT = { app: 'Dev', eng: 'PM' } as const;
const HINT = {
  app: 'Developer view: the running app, its explorer and the panel, section by section (App · Requirements · Decisions · Review · Release)',
  eng: 'Project Management: every page of the project (Overview, Board, Agents, Live app, Approvals, Settings…), with the navigation',
} as const;

/** Builds the switch (the page's, or a test's with its own tab and opener). */
export function viewSwitch(deps: ViewSwitchDeps): ViewSwitch {
  const seg = (v: 'app' | 'eng') =>
    h(
      'button.vs-seg',
      { type: 'button', 'data-view': v, 'aria-pressed': 'false', 'aria-label': `${VIEW_NAMES[v]} view`, title: HINT[v], onclick: () => go(v) },
      h('span.vs-long', {}, VIEW_NAMES[v]),
      h('span.vs-short', { 'aria-hidden': 'true' }, SHORT[v]),
    );
  const dev = seg('app');
  const pm = seg('eng');
  const el = h('div.vs', { role: 'group', 'aria-label': 'View: Developer or Project Management', 'aria-keyshortcuts': 'ArrowLeft ArrowRight' }, dev, pm);
  const now = (): 'app' | 'eng' => (isAppSection(deps.current()) ? 'app' : 'eng');

  function go(v: 'app' | 'eng') {
    if (now() === v) return;
    const tab = deps.current();
    if (v === 'app') deps.open(appSectionFor(tab));
    else {
      const back = deps.cameFrom();
      deps.open(back && !isAppSection(back) ? back : ENGINEERING_FOR[isAppSection(tab) ? tab : APP_SECTIONS[0].id]);
    }
  }

  el.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const v = e.key === 'ArrowLeft' ? 'app' : 'eng';
    go(v);
    (v === 'app' ? dev : pm).focus();
  });

  function draw() {
    const v = now();
    dev.setAttribute('aria-pressed', String(v === 'app'));
    pm.setAttribute('aria-pressed', String(v === 'eng'));
    el.setAttribute('data-view', v);
  }
  draw();
  return { el, draw };
}

/** Puts the switch in the page's top bar, right after Go to Office (where it stays whatever the theme moves). */
export function placeViewSwitch(s: ViewSwitch, bar: Element | null = document.querySelector('header.lite-bar')): boolean {
  if (!bar || bar.querySelector('.vs')) return false;
  const after = bar.querySelector('#view-pick, .vp-go');
  const theme = bar.querySelector('#theme');
  if (after) after.after(s.el);
  else if (theme) theme.before(s.el);
  else bar.append(s.el);
  return true;
}
