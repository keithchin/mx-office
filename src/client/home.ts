// The home page (/home): every project in the building, to go into on the board or in the 2D office
// (🏢 Projects), and the whole office in numbers, project by project (📊 Statistics). It has a page
// of its own, so 🏠 on the flat views always comes here and 🏠 here stays here. Its address never
// carries parameters: which tab you were on is kept in this browser instead. Like the flat views it
// is in the office over the socket (the floors' cards follow it live, and adding a project needs
// it), and it loads no three.js.

import { store } from './state';
import { forgetFloor, lastFloor } from './state/persist';
import { $ } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { flatSession } from './shared/session';
import { graphics, viewUrl } from './graphics';
import { projectsView } from './home/projects';
import { statsView } from './home/stats';
import './home/home.css';

// One address, with nothing after it: an old link with ?floor= or the like still lands here, tidied.
if (location.pathname !== '/home' || location.search || location.hash) history.replaceState(null, '', '/home');

/** The floor this browser was last on, before this page connected (see the welcome below). */
const last = lastFloor();
/** Off to a floor: what this page remembers of it from then on is the floor that was picked. */
let leaving = false;

const session = flatSession(
  '/home',
  // A notification clicked: the worker's terminal is on the 1D view.
  () => location.assign(viewUrl('1d')),
  (msg) => {
    // Coming in puts this page on a floor nobody picked: a browser that had never been on one still
    // hasn't, so / and the flat views keep sending it here (see flatViewGoesHome).
    if (!last && !leaving && (msg.t === 'welcome' || msg.t === 'floor.enter')) forgetFloor();
  },
);
const { net } = session;

// The 🎨 in the top bar: the Default, Dark or Terminal look (ui/colortheme.ts).
colorThemes($('theme'), $('stats-view'));

// ---- Back to the floor you were last on, in the view you were last in -----------------------------
function renderBack() {
  const a = $('to-floor') as HTMLAnchorElement;
  const f = last ? store.floors.find((x) => x.id === last && !x.cloning) : undefined;
  a.classList.toggle('hidden', !f);
  if (!f) return;
  const view = graphics().view;
  a.href = viewUrl(view);
  a.replaceChildren(`${view === '2d' ? '🗺️' : view === '1d' ? '🗂️' : '🏢'} `, Object.assign(document.createElement('span'), { className: 'home-back-name', textContent: f.name }), ' →');
  a.title = `Back to ${f.name}`;
}
store.on('floors', renderBack);

// ---- The tabs ---------------------------------------------------------------------------------
const TAB_KEY = 'agent-office.home-tab';
type Tab = 'projects' | 'stats';
let tab: Tab = 'projects';
try {
  if (localStorage.getItem(TAB_KEY) === 'stats') tab = 'stats';
} catch {
  // No storage: the projects, as usual.
}

const projects = projectsView($('projects-view'), net, last, () => (leaving = true));
const stats = statsView($('stats-view'), () => (leaving = true));

function showTab(t: Tab) {
  tab = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // Just for this visit, then.
  }
  for (const [id, on] of [['projects', t === 'projects'], ['stats', t === 'stats']] as const) {
    $(`tab-${id}`).classList.toggle('on', on);
    $(`tab-${id}`).setAttribute('aria-selected', String(on));
    $(`${id}-view`).classList.toggle('hidden', !on);
  }
  if (t === 'projects') projects.render();
  else void stats.render();
}
$('tab-projects').addEventListener('click', () => showTab('projects'));
$('tab-stats').addEventListener('click', () => showTab('stats'));
// 🏠 here is the page you're on: back to the top of the projects rather than a reload.
$('to-home').addEventListener('click', (e) => {
  e.preventDefault();
  showTab('projects');
  scrollTo({ top: 0 });
});

for (const t of ['floors', 'peers'] as const) store.on(t, () => tab === 'projects' && projects.render());
// The numbers move on by themselves while they're on screen.
setInterval(() => tab === 'stats' && !document.hidden && void stats.render(), 30_000);

session.bellBefore($('theme'));
session.start();
showTab(tab);

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__home = { store, net, showTab };
