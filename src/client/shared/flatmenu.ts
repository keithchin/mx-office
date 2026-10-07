/**
 * The ☰ menu on the flat views' top bars (the 1D board and the 2D pixel office): the 3D office's menu
 * (ui/menuitems.ts has its items, ui/menu.ts draws them), with what each does from here. What only
 * the 3D office has (voice, sharing your screen, hanging a picture, the rooftop bar) is marked 3D and
 * opens the 3D office at it. ⚙️ Settings never does: it's the flat Settings page (ui/settings/page.ts),
 * the 1D view's ⚙️ Settings tab, which `settings` opens (or goToSettings, ui/settings/flat.ts). The
 * camera keys (Controls), the mute button (only while in voice), the 3D panels and the view items
 * (the view dropdown has those) aren't offered. The home page has it too, without what needs a floor
 * (home: true): its issues, PRs, queue, services, whiteboard, meeting, search, docs and who's waiting.
 * No three.js here: both flat views and the home page import it.
 */
import type { Net } from '../net';
import { store } from '../state';
import { h, type Modal } from '../ui/dom';
import { menuItem, openDropdown, type HudAction } from '../ui/menu';
import { MENU, runIn3d, type MenuId } from '../ui/menuitems';
import { badgeText } from '../ui/chrome-logic';
import type { BoardActions } from '../ui/github/prompts';
import { openBoard } from '../ui/boards';
import { openQueue } from '../ui/queue';
import { openServices } from '../ui/services';
import { openWhiteboard } from '../ui/whiteboard';
import { openSearch } from '../ui/search';
import { openBookshelf } from '../ui/bookshelf';
import { openTeam } from '../ui/team';
import { openAccounts } from '../ui/accounts';
import { openConnections } from '../ui/connections';
import { openSignIns } from '../ui/signins';
import { openUpgrade } from '../ui/upgrade';
import { switchView } from '../graphics';
import { settingsHref } from '../../shared/settings-sections';
import { testsHref } from '../../shared/testlab';
import { openStudio, watchStudio } from '../ui/studio';
import '../ui/menu.css';
import '../ui/flatchrome.css';

export type FlatMenuDeps = FloorMenuDeps | { net: Net; home: true; settings?: () => void; tests?: () => void };

interface FloorMenuDeps {
  net: Net;
  home?: false;
  boardActions: () => BoardActions;
  openWorker: (id: string) => void;
  meeting: () => void;
  /** The next worker waiting on someone. */
  nextWaiting: () => void;
  /** The page has the 3D office's N for it (the 2D view does). */
  nKey?: boolean;
  /** ⚙️ Settings: the 1D view's own tab there, the 1D view's tab from elsewhere. */
  settings?: () => void;
  /** 🧪 Test mode: the 1D view's own tab there, its address from elsewhere. */
  tests?: () => void;
}

/** What only makes sense on a floor, left out of the home page's ☰. */
const FLOOR_ONLY = new Set(['waiting', 'issues', 'pulls', 'queue', 'services', 'whiteboard', 'meeting', 'search', 'docs', 'studio']);

const githubUrl = (remote?: string) => {
  const m = remote?.match(/github\.com[:/]([^/]+\/[^/.]+)/);
  return m ? `https://github.com/${m[1]}` : undefined;
};
let pageSound = false;

/** The floor's docs on the bookshelf window (the 2D view's bookshelf opens it too). */
export function openDocs() {
  if (!store.floor) return;
  openBookshelf({ floor: store.floor, project: store.project?.name, repoUrl: githubUrl(store.project?.remote), onTurn: () => {}, pageSound, onPageSound: (on) => (pageSound = on) });
}

/** The same red count as the tabs' (ui/badge.ts). */
const count = (n: number | undefined) => (n ? h('span.ro-tab-n', {}, badgeText(n)) : null);

/** Wires `button` (the ☰ on the top bar) to open the menu. */
export function flatMenu(button: HTMLElement, d: FlatMenuDeps) {
  const { net } = d;
  /** One only the 3D office has: it opens there and runs it. */
  const in3d = (id: MenuId, title: string): HudAction => ({ ...MENU[id], key: undefined, title: () => `${title} · opens the 3D office`, run: () => (runIn3d(id), switchView('3d')) });
  // On the home page none of the floor's items are offered, so these never run there.
  const f: FloorMenuDeps = d.home ? { net, boardActions: () => ({}) as BoardActions, openWorker: () => {}, meeting: () => {}, nextWaiting: () => {} } : d;
  const all: HudAction[] = [
    { ...MENU.waiting, key: f.nKey ? 'N' : undefined, run: f.nextWaiting },
    { ...MENU.issues, run: () => openBoard('issues', net, f.boardActions()) },
    { ...MENU.pulls, run: () => openBoard('pulls', net, f.boardActions()) },
    { ...MENU.queue, run: () => openQueue(net, { openTerminal: f.openWorker }) },
    { ...MENU.services, run: () => openServices() },
    { ...MENU.whiteboard, run: () => openWhiteboard(net) },
    { ...MENU.meeting, run: f.meeting },
    { ...MENU.search, key: undefined, run: () => openSearch((id) => f.openWorker(id)) },
    { ...MENU.docs, shown: () => !!store.floor, run: openDocs },
    { ...MENU.studio, run: () => void openStudio() },
    // Every floor's card, with how many wait on someone, is the home page (its Projects tab, from there).
    { ...MENU.elevator, run: () => (d.home ? (document.getElementById('tab-projects')?.click(), scrollTo({ top: 0 })) : location.assign('/home')) },
    in3d('roof', 'Up to the roof: a DJ, drinks and the city'),
    in3d('voice', 'Talk with the others in the office'),
    in3d('share', 'Share your screen with the others in the office'),
    in3d('decor', 'Hang a picture on the office wall'),
    { ...MENU.team, run: () => openTeam(net) },
    { ...MENU.accounts, run: () => openAccounts(net) },
    { ...MENU.signins, run: () => openSignIns(net) },
    { ...MENU.settings, title: () => 'Every setting: you, the workers, the team, Jeff, notifications, the budget, connections and the rest', run: () => (d.settings ? d.settings() : location.assign(settingsHref(undefined, store.floor ?? undefined))) },
    { ...MENU.connections, run: () => openConnections() },
    // 🧪 Test mode (ui/testlab/): the flat views' page only, never the 3D office; admins only.
    { id: 'tests', icon: '🧪', label: 'Test mode', section: 'Office', shown: () => store.me.admin, title: () => 'Test mode and the performance guard: run the page, journey and unit suites against a throwaway test office, and see the results', run: () => (d.tests ? d.tests() : location.assign(testsHref(store.floor ?? store.floors[0]?.id))) },
    { ...MENU.home, shown: () => !d.home, run: () => location.assign('/home') },
    { ...MENU.guide, run: () => location.assign('/docs') },
    { ...MENU.upgrade, run: () => openUpgrade(net) },
  ];
  const actions = d.home ? all.filter((a) => !FLOOR_ONLY.has(a.id)) : all;
  if (!d.home) watchStudio();
  const elsewhere = new Set<string>(['roof', 'voice', 'share', 'decor']);
  let menu: Modal | null = null;

  function open() {
    const close = () => menu?.close();
    const row = (a: HudAction) => {
      const item = menuItem(a, close, count);
      if (elsewhere.has(a.id)) item.querySelector('.mi-label')!.after(h('span.mi-3d', { 'aria-hidden': 'true' }, '3D ↗'));
      return h('div.menu-row', {}, item);
    };
    const section = (name: string, rows: HTMLElement[]) => (rows.length ? [h('div.menu-sec', {}, name), ...rows] : []);
    const rows = (s: HudAction['section']) => actions.filter((a) => a.section === s && (a.shown?.() ?? true)).map(row);
    const el = h(
      'div.hud-menu.flat-menu',
      { role: 'menu', 'aria-label': 'Menu' },
      h('div.menu-col', {}, ...section('Open', rows('Open'))),
      h('div.menu-col', {}, ...section('Together', rows('Together')), ...section('Office', rows('Office'))),
      h('p.menu-foot', {}, d.home ? 'The ones marked 3D ↗ open the 3D office there. What works on one floor (its issues, PRs, queue, whiteboard, meeting…) is in each project.' : 'The ones marked 3D ↗ open the 3D office there. The view is in the dropdown by the ☰.'),
    );
    menu = openDropdown(button, el, () => (menu = null));
  }

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => (menu ? menu.close() : open()));
}
