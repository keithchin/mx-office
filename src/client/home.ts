// The home page (/home): every project in the building, to go into on the board or in the 2D office
// (🏢 Projects), the whole office in numbers, project by project (📊 Statistics), and every floor from
// above in pixel art (🗺️ 2D Overview). It has a page of its own, so 🏠 on the flat views always comes
// here and 🏠 here stays here. Its address never keeps parameters: which tab you were on is kept in
// this browser instead (a link can still open one, ?tab=overview or #overview, before it's tidied).
// Like the flat views it is in the office over the socket (the floors' cards follow it live, and
// adding a project needs it).

import { store } from './state';
import { forgetFloor, lastFloor } from './state/persist';
import { $ } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { flatSession } from './shared/session';
import { flatMenu } from './shared/flatmenu';
import { projectUrl } from './ui/viewpick';
import { projectsView } from './home/projects';
import { statsView } from './home/stats';
import { overviewView } from './home/overview';
import { homeAudit } from './home/audit';
import { testModeBadge } from './ui/testmode';
import { homeBudget } from './home/budget';
import { goToSettings } from './ui/settings/flat';
import { testsHref } from '../shared/testlab';
import { portalBar } from './ui/portal/topbar';
import { portalHead } from './home/portal';
import { firstRunGate } from './first-run/gate';
import './home/home.css';
import './shared/perfwatch-on';

/** The tab a link asked for (?tab= or a bare #), read before the address is tidied. */
const asked = new URLSearchParams(location.search).get('tab') ?? location.hash.slice(1);
// One address, with nothing after it: an old link with ?floor= or the like still lands here, tidied.
if (location.pathname !== '/home' || location.search || location.hash) history.replaceState(null, '', '/home');

/** The floor this browser was last on, before this page connected (see the welcome below). */
const last = lastFloor();
/** Off to a floor: what this page remembers of it from then on is the floor that was picked. */
let leaving = false;

const session = flatSession(
  '/home',
  // A notification clicked: the worker's terminal is on the 1D view.
  () => location.assign(projectUrl(lastFloor())),
  (msg) => {
    audit.onMessage(msg);
    // Coming in puts this page on a floor nobody picked: a browser that had never been on one still
    // hasn't, so / and the flat views keep sending it here (see flatViewGoesHome).
    if (!last && !leaving && (msg.t === 'welcome' || msg.t === 'floor.enter')) forgetFloor();
  },
);
const { net } = session;

// The 🎨 in the top bar: the Default, Dark or Terminal look (ui/colortheme.ts). The overview's floors are tinted to match.
colorThemes($('theme'), $('stats-view'), () => {
  overview.themed();
  // The Portal themes draw the projects as their Projects page (home/portal.ts), the others as cards.
  if (tab === 'projects') projects.render();
});

// ---- Back to the floor you were last on -------------------------------------------------------------
function renderBack() {
  const a = $('to-floor') as HTMLAnchorElement;
  const f = last ? store.floors.find((x) => x.id === last && !x.cloning) : undefined;
  a.classList.toggle('hidden', !f);
  if (!f) return;
  a.href = projectUrl(f.id);
  a.replaceChildren('🗂️ ', Object.assign(document.createElement('span'), { className: 'home-back-name', textContent: f.name }), ' →');
  a.title = `Back to ${f.name}`;
}
store.on('floors', renderBack);

// ---- The tabs ---------------------------------------------------------------------------------
const TAB_KEY = 'agent-office.home-tab';
const TABS = ['projects', 'stats', 'overview', 'audit', 'budget'] as const;
type Tab = (typeof TABS)[number];
const isTab = (t: unknown): t is Tab => TABS.includes(t as Tab);
let tab: Tab = 'projects';
try {
  const kept = localStorage.getItem(TAB_KEY);
  if (isTab(kept)) tab = kept;
} catch {
  // No storage: the projects, as usual.
}
if (isTab(asked)) tab = asked;

const projects = projectsView($('projects-view'), net, last, () => (leaving = true));
const stats = statsView($('stats-view'), () => (leaving = true));
const overview = overviewView($('overview-view'), () => (leaving = true));
const audit = homeAudit($('audit-view'));
// 💰 Every project's spend against its budget (home/budget.ts).
const budget = homeBudget($('budget-view'), () => (leaving = true));

function showTab(t: Tab) {
  tab = t;
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // Just for this visit, then.
  }
  for (const id of TABS) {
    const on = id === t;
    $(`tab-${id}`).classList.toggle('on', on);
    $(`tab-${id}`).setAttribute('aria-selected', String(on));
    $(`${id}-view`).classList.toggle('hidden', !on);
  }
  if (t === 'overview') overview.show();
  else overview.hide();
  if (t === 'audit') audit.show();
  else audit.hide();
  if (t === 'budget') budget.show();
  else budget.hide();
  if (t === 'projects') projects.render();
  else if (t === 'stats') void stats.render();
}
for (const id of TABS) $(`tab-${id}`).addEventListener('click', () => showTab(id));
// 🏠 here is the page you're on: back to the top of the projects rather than a reload.
$('to-home').addEventListener('click', (e) => {
  e.preventDefault();
  showTab('projects');
  scrollTo({ top: 0 });
});

for (const t of ['floors', 'peers', 'me'] as const) store.on(t, () => tab === 'projects' && projects.render());
// The numbers move on by themselves while they're on screen.
setInterval(() => tab === 'stats' && !document.hidden && void stats.render(), 30_000);

// The ☰, last on the bar as on every page: here, only what doesn't need a floor (shared/flatmenu.ts).
flatMenu($('menu'), { net, home: true, settings: () => goToSettings(session) });
// 🧪 Test mode, for admins: the 1D view's page (ui/testlab/), on a floor so it opens.
const renderTests = () => {
  const a = $('to-tests') as HTMLAnchorElement;
  a.classList.toggle('hidden', !store.me.admin);
  a.href = testsHref(last ?? store.floors[0]?.id);
};
store.on('me', renderTests);
store.on('floors', renderTests);

session.bellBefore($('theme'));
// The Portal themes' top bar (ui/portal/) and the Projects page's title over the tabs (home/portal.ts).
const backToProjects = () => {
  showTab('projects');
  scrollTo({ top: 0 });
};
portalBar({ section: 'Projects', onHome: backToProjects, settings: () => goToSettings(session) });
portalHead(document.querySelector<HTMLElement>('.home-main')!, projects);
session.start();
testModeBadge(); // the TEST MODE badge (ui/testmode/)
firstRunGate(() => projects.newProject()); // 🚀 a new office's setup (first-run/), and ?new from its last step
showTab(tab);

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__home = { store, net, showTab };
