// Home (/start): the office's landing page, where the Mx Office wordmark, the 🏠 and a bare / go. What needs
// you and how everything is going, across every client and project (start/view.ts), with the office's
// pages in a left navigation in a Portal theme (start/nav.ts). Like the Projects and Clients pages it is in
// the office over the socket, so the projects follow the office live; its address never keeps parameters.

import { forgetFloor, lastFloor, rememberFloor } from './state/persist';
import { store } from './state';
import { $ } from './ui/dom';
import { colorThemes } from './ui/colortheme';
import { flatSession } from './shared/session';
import { flatMenu } from './shared/flatmenu';
import { projectUrl } from './ui/viewpick';
import { testModeBadge } from './ui/testmode';
import { goToSettings } from './ui/settings/flat';
import { portalBar } from './ui/portal/topbar';
import { hideOverlay, showOverlay } from './ui/loading/overlay';
import { openWizard } from './ui/wizard/open';
import { openAddProject } from './ui/add-project';
import { newPortfolioDialog } from './ui/portfolios/dialogs';
import { firstRunGate } from './first-run/gate';
import { HOME_PAGE } from '../shared/start';
import { officeNav } from './start/nav';
import { startView } from './start/view';
import './home/home.css';
import './home/portal.css';
import './shared/perfwatch-on';

/** The floor this browser was last on, before this page connected. */
const last = lastFloor();
let leaving = false;
// One address, with nothing after it (?new was read by the first-run gate as it loaded, before this tidies it).
if (location.pathname !== HOME_PAGE || location.search || location.hash) history.replaceState(null, '', HOME_PAGE);

const session = flatSession(
  HOME_PAGE,
  () => location.assign(projectUrl(lastFloor())),
  (msg) => {
    // As on the Projects page: coming in puts the page on a floor nobody picked, which this browser shouldn't remember.
    if (!last && !leaving && (msg.t === 'welcome' || msg.t === 'floor.enter')) forgetFloor();
    if (msg.t === 'welcome') view.welcomed();
    else if (msg.t === 'roster.changed') view.changed();
  },
);
const { net } = session;

/** Into a project (its 1D view), remembered as the one this browser was last on. */
function openProject(floor: string) {
  leaving = true;
  rememberFloor(floor);
  const name = store.floors.find((f) => f.id === floor)?.name ?? floor;
  showOverlay({ title: `Loading project ${name}… 0 %`, step: 'Opening the project…', pct: 0 });
  addEventListener('pageshow', (e) => e.persisted && hideOverlay(), { once: true });
  location.assign(projectUrl(floor));
}

const newProject = () => void openWizard({ net, go: openProject });
colorThemes($('theme'));
officeNav('home');
const view = startView($('start-view'), {
  open: openProject,
  newProject,
  addProject: () => openAddProject({ net, go: openProject }),
  newClient: (opener) => newPortfolioDialog(opener, (r) => r.portfolio && location.assign(`/clients?client=${encodeURIComponent(r.portfolio.id)}`)),
});
flatMenu($('menu'), { net, home: true, settings: () => goToSettings(session) });
session.bellBefore($('theme'));
// The Portal themes' top bar (ui/portal/): HOME, and its wordmark back to the top of this page.
portalBar({ section: 'Home', onHome: () => scrollTo({ top: 0 }), settings: () => goToSettings(session) });
$('to-home').addEventListener('click', (e) => {
  e.preventDefault();
  scrollTo({ top: 0 });
});
session.start();
testModeBadge();
// 🚀 A new office's setup (first-run/): an admin is sent there once; its last step comes back with ?new.
firstRunGate(newProject);

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__start = { store, net, view };
