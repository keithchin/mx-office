import './projects.css';
/**
 * The home page's 🏢 Projects tab: a card for every floor of the building (every project), each to
 * open on its 1D view (/lite, its Command Center), with ✨ New project and ➕ Add project.
 * It used to be the floors page over the flat views (shared/floors.ts).
 */
import type { Net } from '../net';
import { store } from '../state';
import { rememberFloor } from '../state/persist';
import { cloneLabel, floorPalette } from '../../shared/floors';
import type { FloorInfo } from '../../shared/protocol';
import { h } from '../ui/dom';
import { openAddProject } from '../ui/add-project';
import { openWizard } from '../ui/wizard';
import { openConnections } from '../ui/connections';
import { summaryLine } from '../ui/summary';
import { homeRunIcon, homeRunToggle } from './run-state';
import { hideOverlay, showOverlay } from '../ui/loading/overlay';
import { miniProgress } from '../ui/progress/mini';
import { isPortal } from '../ui/clean';
import { portalProjects } from './portal';
import { projectUrl } from '../ui/viewpick';

/** The page that opens `floor`: its 1D view, whose address names the floor, so it opens straight on it. */
export const floorUrl = (floor: string) => projectUrl(floor);

/** Into `floor` (its 1D view), which becomes what this browser remembers. `leaving` hears it go first. */
export function openFloor(floor: string, leaving: () => void) {
  leaving();
  rememberFloor(floor);
  // At once, while the next page comes (it has Mx Office's loading screen, then the floor's overlay); hidden again if Back returns here.
  const name = store.floors.find((f) => f.id === floor)?.name ?? floor;
  showOverlay({ title: `Loading project ${name}… 0 %`, step: 'Opening the project…', pct: 0 });
  addEventListener('pageshow', (e) => e.persisted && hideOverlay(), { once: true });
  location.assign(floorUrl(floor));
}

export interface ProjectsView {
  render(): void;
  /** ✨ New project: the wizard. */
  newProject(): void;
  /** ➕ Add project: clone one of the repositories. */
  addProject(): void;
}

/**
 * Draws the cards into `root`. `last` is the floor this browser was last on (marked on its card);
 * `leaving` hears the page head off to a floor.
 */
export function projectsView(root: HTMLElement, net: Net, last: string | null, leaving: () => void): ProjectsView {
  const go = (id: string) => openFloor(id, leaving);

  /** The floor's project summary in a line (its stage, who's working, who needs you), filled in once it's fetched. */
  const summaryOf = (floor: string) => {
    const line = h('p.home-floor-summary', {});
    void summaryLine(floor).then((t) => (line.textContent = t));
    return line;
  };

  const card = (f: FloorInfo, i: number) => {
    const wasHere = f.id === last;
    const stats: string[] = f.cloning
      ? [cloneLabel(f.clone)]
      : [f.waiting && `🙋 ${f.waiting} waiting`, f.busy && `👷 ${f.busy} working`, `💻 ${f.workers} agent${f.workers === 1 ? '' : 's'}`, f.people && `🧑 ${f.people} here`].filter((s): s is string => !!s);
    const open = h('a.btn.primary', { href: floorUrl(f.id), 'aria-disabled': f.cloning ? 'true' : undefined, title: `${f.name}: its Command Center, board, agents and tabs`, onclick: (e: Event) => {
        e.preventDefault();
        if (!f.cloning) openFloor(f.id, leaving);
      } }, '🗂️ Open project');
    return h(
      'li.home-floor',
      { class: `${wasHere ? 'here' : ''}${f.waiting ? ' waiting' : ''}${f.cloning ? ' cloning' : ''}`, style: `--floor:${floorPalette(f.palette).trim}` },
      h('div.home-floor-top', {}, h('span.home-floor-no', {}, String(i + 1)), h('span.home-floor-name', {}, f.name), f.cloning ? null : homeRunIcon(f.id), wasHere ? h('span.home-here', {}, 'last visited') : null),
      h('p.home-floor-sub', {}, [f.repo ?? f.dir, f.branch && `⎇ ${f.branch}`].filter(Boolean).join(' · ')),
      f.cloning && f.clone?.percent !== undefined ? h('span.home-bar', {}, h('span', { style: `width:${f.clone.percent}%` })) : null,
      h('p.home-floor-stats', {}, stats.join(' · ')),
      f.cloning ? null : summaryOf(f.id),
      // Its progress bar, small: the phases and where it is, or the version accepted (ui/progress/mini.ts).
      f.cloning ? null : miniProgress(f.id),
      h('div.home-floor-go', {}, open),
    );
  };

  const addProject = () => openAddProject({ net, go });
  const newProject = () => void openWizard({ net, go });
  // In a Portal theme the tab is the Projects page (home/portal.ts).
  const portal = portalProjects(root, { net, last, open: (id) => openFloor(id, leaving), newProject, addProject, connections: () => openConnections() });

  const render = () => {
    if (isPortal()) return portal.render();
    const add = h('button.btn.home-add', { type: 'button', title: "Clone one of the repositories this office's gh login can see, as a new floor" }, '➕ Add project');
    add.addEventListener('click', addProject);
    const wizard = h('button.btn.primary.home-add', { type: 'button', title: 'Create a new project repository and set it up with the mxcli project toolkit, a step at a time', onclick: newProject }, '✨ New project');
    // The office's tokens and folders, for admins: what a new project needs before it starts (ui/connections/).
    const connections = store.me.admin ? h('button.btn.home-add', { type: 'button', title: 'The GitHub and Mendix tokens, the password, git & gh and the folders the office uses', onclick: () => openConnections() }, '🔌 Connections') : null;
    root.replaceChildren(
      h('div.home-head', {}, h('h2', {}, '🏢 Projects'), h('span.seg', {}, wizard, add, connections), homeRunToggle()),
      h('p.home-intro', {}, store.floors.length ? 'Every project is a floor of this building. Open one for its Command Center, board and agents.' : "This building has no floors yet. ➕ Add project clones one of your repositories, and it becomes the first floor."),
      h('ul.home-floors', {}, ...store.floors.map(card)),
    );
  };
  return { render, newProject, addProject };
}
