// The Clients page (/clients): every client as a card in the Projects page's grid, ＋ New client, and a
// client's own page (/clients?client=<id>) with Rename, its company brain and its projects as the Projects
// page's cards (clients/view.ts). Like Home it is in the office over the socket, so the project cards
// follow the floors live; /home?tab=portfolios (the old Home tab) comes here.

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
import { clientsView } from './clients/view';
import { openWizard } from './ui/wizard/open';
import './home/home.css';
import './shared/perfwatch-on';

/** The floor this browser was last on, before this page connected. */
const last = lastFloor();
let leaving = false;

const session = flatSession(
  '/clients',
  () => location.assign(projectUrl(lastFloor())),
  (msg) => {
    // As on Home: coming in puts the page on a floor nobody picked, which this browser shouldn't remember.
    if (!last && !leaving && (msg.t === 'welcome' || msg.t === 'floor.enter')) forgetFloor();
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

colorThemes($('theme'));
// ＋ New project on a client: ✨ New project made for it, opening the project once it's set up.
const view = clientsView($('clients-view'), { last, open: openProject, newProject: (client) => void openWizard({ net, go: openProject, client }) });
flatMenu($('menu'), { net, home: true, settings: () => goToSettings(session) });
session.bellBefore($('theme'));
// The Portal themes' top bar (ui/portal/): CLIENTS, and its wordmark back to the clients' cards.
portalBar({ section: 'Clients', settings: () => goToSettings(session) });
session.start();
testModeBadge();

// Debug handle for quick checks from the console / headless screenshots.
(window as any).__clients = { store, net, view };
