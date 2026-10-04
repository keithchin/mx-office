import './floors.css';
/**
 * The building's floors on the flat views (the 1D board at /lite and the 2D pixel office at /pixel):
 * the floor picker on the top bar, and the floors page, a card for every floor (every project) to go
 * into on either view, with a way to add another. No three.js here: both flat views import it.
 */
import type { Net } from '../net';
import { store } from '../state';
import { rememberFloor } from '../state/persist';
import { cloneLabel, floorPalette } from '../../shared/floors';
import type { FloorInfo } from '../../shared/protocol';
import { $, h } from '../ui/dom';
import { openElevator } from '../ui/elevator';
import { openWizard } from '../ui/wizard';
import { summaryLine } from '../ui/summary';
import { switchView } from '../graphics';
import { renderTitle } from './title';

/** A flat view: the 1D board, or the 2D pixel office. */
export type FlatView = '1d' | '2d';

const floorLabel = (f: FloorInfo) => `${f.name}${f.cloning ? ` (${cloneLabel(f.clone)})` : f.waiting ? ` · 🙋 ${f.waiting}` : ''}`;

/** This tab has picked a floor (on the floors page or the picker), so a reload stays on it rather than going back to the floors page. */
const PICKED_KEY = 'agent-office.floor-picked';
function picked(): boolean {
  try {
    return sessionStorage.getItem(PICKED_KEY) === '1';
  } catch {
    return false;
  }
}
function pick() {
  try {
    sessionStorage.setItem(PICKED_KEY, '1');
  } catch {
    // Just for this page, then.
  }
}

/** Goes to `floor` on this page, if it isn't the one you're on already. */
function go(net: Net, floor: string) {
  pick();
  if (floor !== store.floor) net.send({ t: 'floor.go', floor });
}

/**
 * The floor picker on the top bar (#floor), what the floor is (#floor-meta), and a button straight
 * to any other floor where someone's waiting (#elsewhere, when the page has one).
 */
export function floorPicker(net: Net) {
  const select = $('floor') as HTMLSelectElement;
  const render = () => {
    const options = store.floors.map((f) => h('option', { value: f.id, disabled: !!f.cloning }, floorLabel(f)));
    if (!store.floors.length) options.push(h('option', { value: '' }, 'No floors yet'));
    select.replaceChildren(...options);
    select.value = store.floor ?? '';
    select.disabled = store.floors.length < 2;
    const p = store.project;
    const f = store.currentFloor();
    $('floor-meta').textContent = p ? [p.branch && `⎇ ${p.branch}`, f?.repo ?? p.dir, f && `👥 ${f.people} here`].filter(Boolean).join(' · ') : store.floors.length ? '' : 'No floors yet: 🏠 Floors adds a project.';
    const box = document.getElementById('elsewhere');
    if (box) {
      const elsewhere = store.floors.filter((o) => o.id !== store.floor && o.waiting > 0 && !o.cloning);
      box.classList.toggle('hidden', !elsewhere.length);
      box.replaceChildren(
        ...elsewhere.map((o) => h('button.btn.lite-go', { type: 'button', onclick: () => go(net, o.id) }, `🙋 ${o.waiting} waiting on ${o.name}`, h('span', { 'aria-hidden': 'true' }, '→'))),
      );
    }
    renderTitle();
  };
  select.addEventListener('change', () => {
    if (select.value) go(net, select.value);
  });
  store.on('floors', render);
  store.on('floor', render);
  store.on('project', render);
  render();
}

export interface FloorsHome {
  show(): void;
  hide(): void;
  readonly shown: boolean;
}

/**
 * The floors page (#home): a card for every floor, each to go into on this view or the other flat
 * one, and ➕ Add project. `view` is the page's own view; `onShow` hears it come and go, for the page
 * to hide what's under it. It opens on its own when this tab hasn't picked a floor yet and there's
 * more than one to pick from (or none: then there's only adding one), or when the address asks
 * (?home), and the 🏠 Floors button (#to-home) opens it.
 */
export function floorsHome(net: Net, view: FlatView, onShow: (shown: boolean) => void): FloorsHome {
  const el = $('home');
  const asked = new URLSearchParams(location.search).has('home');
  if (asked) history.replaceState(null, '', location.pathname);
  let shown = false;
  let decided = false;

  const enter = (f: FloorInfo, into: FlatView) => {
    if (into === view) {
      go(net, f.id);
      return home.hide();
    }
    // The other flat view: it comes in on this floor (see Net.connect).
    pick();
    rememberFloor(f.id);
    switchView(into);
  };

  /** The floor's project summary in a line (its stage, who's working, who needs you), filled in once it's fetched. */
  const summaryOf = (floor: string) => {
    const line = h('p.home-floor-summary', {});
    void summaryLine(floor).then((t) => (line.textContent = t));
    return line;
  };

  const card = (f: FloorInfo, i: number) => {
    const here = f.id === store.floor;
    const stats: string[] = f.cloning
      ? [cloneLabel(f.clone)]
      : [f.waiting && `🙋 ${f.waiting} waiting`, f.busy && `👷 ${f.busy} working`, `💻 ${f.workers} worker${f.workers === 1 ? '' : 's'}`, f.people && `🧑 ${f.people} here`].filter((s): s is string => !!s);
    const button = (into: FlatView, label: string, title: string) =>
      h('button.btn', { type: 'button', class: into === view ? 'primary' : '', disabled: !!f.cloning, title, onclick: () => enter(f, into) }, label);
    return h(
      'li.home-floor',
      { class: `${here ? 'here' : ''}${f.waiting ? ' waiting' : ''}`, style: `--floor:${floorPalette(f.palette).trim}` },
      h('div.home-floor-top', {}, h('span.home-floor-no', {}, String(i + 1)), h('span.home-floor-name', {}, f.name), here ? h('span.home-here', {}, 'you are here') : null),
      h('p.home-floor-sub', {}, [f.repo ?? f.dir, f.branch && `⎇ ${f.branch}`].filter(Boolean).join(' · ')),
      f.cloning && f.clone?.percent !== undefined ? h('span.home-bar', {}, h('span', { style: `width:${f.clone.percent}%` })) : null,
      h('p.home-floor-stats', {}, stats.join(' · ')),
      f.cloning ? null : summaryOf(f.id),
      h('div.home-floor-go', {}, button('1d', '🗂️ Board', `${f.name}'s board: its pipeline from issue to merged PR, and its workers`), button('2d', '🗺️ Office', `${f.name} from above: every worker at its desk`)),
    );
  };

  const render = () => {
    if (!shown) return;
    const add = h('button.btn.home-add', { type: 'button', title: "Clone one of the repositories this office's gh login can see, as a new floor" }, '➕ Add project');
    add.addEventListener('click', () => openElevator({ net, addOnly: true, downstairs: () => false, ride: (id) => (go(net, id), home.hide()) }));
    el.replaceChildren(
      h('div.home-head', {}, h('h2', {}, '🏢 Floors'), h('span.seg', {}, h('button.btn.primary.home-add', { type: 'button', title: 'Create a new project repository and set it up with the mxcli project toolkit, a step at a time', onclick: () => void openWizard({ net, go: (id) => (go(net, id), home.hide()) }) }, '✨ New project'), add)),
      h('p.home-intro', {}, store.floors.length ? 'Every project is a floor of this building. Pick one to go into, on the board or in the office.' : "This building has no floors yet. ➕ Add project clones one of your repositories, and it becomes the first floor."),
      h('ul.home-floors', {}, ...store.floors.map(card)),
    );
  };

  const home: FloorsHome = {
    show() {
      shown = true;
      el.classList.remove('hidden');
      onShow(true);
      render();
    },
    hide() {
      shown = false;
      el.classList.add('hidden');
      onShow(false);
    },
    get shown() {
      return shown;
    },
  };

  // Once the office has said which floors there are: on to the floor you're on, unless there's a choice to make.
  const decide = () => {
    if (decided) return;
    decided = true;
    if (asked || !store.floor || (!picked() && store.floors.filter((f) => !f.cloning).length > 1)) home.show();
    else home.hide();
  };
  // The welcome puts you on a floor (when the building has one); going to another is floor.enter.
  net.onMessage((msg) => {
    if (msg.t === 'welcome') decide();
    else if (msg.t === 'floor.enter' && picked()) home.hide();
  });
  for (const t of ['floors', 'floor', 'peers'] as const) store.on(t, render);
  document.getElementById('to-home')?.addEventListener('click', () => (shown && store.floor ? home.hide() : home.show()));
  // Until the office answers: the floors page if that's where this is going, so nothing jumps about.
  if (asked || !picked()) home.show();
  return home;
}
