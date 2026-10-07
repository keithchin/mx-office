import './projects.css';
/**
 * The home page's 🏢 Projects tab: a card for every floor of the building (every project), each to
 * open on the board (/lite) or in the 2D office (/pixel), with ✨ New project and ➕ Add project.
 * It used to be the floors page over the flat views (shared/floors.ts). No three.js here.
 */
import type { Net } from '../net';
import { store } from '../state';
import { rememberFloor } from '../state/persist';
import { cloneLabel, floorPalette } from '../../shared/floors';
import type { FloorInfo } from '../../shared/protocol';
import { h } from '../ui/dom';
import { openElevator } from '../ui/elevator';
import { openWizard } from '../ui/wizard';
import { openConnections } from '../ui/connections';
import { summaryLine } from '../ui/summary';
import { graphics, rememberView } from '../graphics';
import { homeRunIcon, homeRunToggle } from './run-state';

/** A flat view: the 1D board, or the 2D pixel office. */
type FlatView = '1d' | '2d';

/** The page that opens `floor` in `view`: its address names the floor, so it opens straight on it. */
export const floorUrl = (floor: string, view: FlatView) => `${view === '2d' ? '/pixel' : '/lite'}?floor=${encodeURIComponent(floor)}`;

/** Into `floor` on `view`, which both become what this browser remembers. `leaving` hears it go first. */
export function openFloor(floor: string, view: FlatView, leaving: () => void) {
  leaving();
  rememberFloor(floor);
  rememberView(view);
  location.assign(floorUrl(floor, view));
}

export interface ProjectsView {
  render(): void;
}

/**
 * Draws the cards into `root`. `last` is the floor this browser was last on (marked on its card);
 * `leaving` hears the page head off to a floor.
 */
export function projectsView(root: HTMLElement, net: Net, last: string | null, leaving: () => void): ProjectsView {
  // The view you were last in is the one each card offers first.
  const usual: FlatView = graphics().view === '2d' ? '2d' : '1d';
  const go = (id: string) => openFloor(id, usual, leaving);

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
      : [f.waiting && `🙋 ${f.waiting} waiting`, f.busy && `👷 ${f.busy} working`, `💻 ${f.workers} worker${f.workers === 1 ? '' : 's'}`, f.people && `🧑 ${f.people} here`].filter((s): s is string => !!s);
    const button = (into: FlatView, label: string, title: string) =>
      h('a.btn', { href: floorUrl(f.id, into), class: into === usual ? 'primary' : '', 'aria-disabled': f.cloning ? 'true' : undefined, title, onclick: (e: Event) => {
          e.preventDefault();
          if (!f.cloning) openFloor(f.id, into, leaving);
        } }, label);
    return h(
      'li.home-floor',
      { class: `${wasHere ? 'here' : ''}${f.waiting ? ' waiting' : ''}${f.cloning ? ' cloning' : ''}`, style: `--floor:${floorPalette(f.palette).trim}` },
      h('div.home-floor-top', {}, h('span.home-floor-no', {}, String(i + 1)), h('span.home-floor-name', {}, f.name), f.cloning ? null : homeRunIcon(f.id), wasHere ? h('span.home-here', {}, 'last visited') : null),
      h('p.home-floor-sub', {}, [f.repo ?? f.dir, f.branch && `⎇ ${f.branch}`].filter(Boolean).join(' · ')),
      f.cloning && f.clone?.percent !== undefined ? h('span.home-bar', {}, h('span', { style: `width:${f.clone.percent}%` })) : null,
      h('p.home-floor-stats', {}, stats.join(' · ')),
      f.cloning ? null : summaryOf(f.id),
      h('div.home-floor-go', {}, button('1d', '🗂️ Board', `${f.name}'s board: its pipeline from issue to merged PR, and its workers`), button('2d', '🗺️ Office', `${f.name} from above: every worker at its desk`)),
    );
  };

  const render = () => {
    const add = h('button.btn.home-add', { type: 'button', title: "Clone one of the repositories this office's gh login can see, as a new floor" }, '➕ Add project');
    add.addEventListener('click', () => openElevator({ net, addOnly: true, downstairs: () => false, ride: go }));
    const wizard = h('button.btn.primary.home-add', { type: 'button', title: 'Create a new project repository and set it up with the mxcli project toolkit, a step at a time', onclick: () => void openWizard({ net, go }) }, '✨ New project');
    // The office's tokens and folders, for admins: what a new project needs before it starts (ui/connections/).
    const connections = store.me.admin ? h('button.btn.home-add', { type: 'button', title: 'The GitHub and Mendix tokens, the password, git & gh and the folders the office uses', onclick: () => openConnections() }, '🔌 Connections') : null;
    root.replaceChildren(
      h('div.home-head', {}, h('h2', {}, '🏢 Projects'), h('span.seg', {}, wizard, add, connections), homeRunToggle()),
      h('p.home-intro', {}, store.floors.length ? 'Every project is a floor of this building. Open one on its board, or in the office from above.' : "This building has no floors yet. ➕ Add project clones one of your repositories, and it becomes the first floor."),
      h('ul.home-floors', {}, ...store.floors.map(card)),
    );
  };
  return { render };
}
