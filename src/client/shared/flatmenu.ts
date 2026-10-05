/**
 * The ☰ menu on the flat views' top bars (the 1D board and the 2D pixel office): the 3D office's menu
 * (ui/menuitems.ts has its items, ui/menu.ts draws them), with what each does from here. What only
 * the 3D office has (voice, sharing your screen, hanging a picture, the rooftop bar, Settings, whose
 * window draws the sky and your character in 3D) is marked 3D and opens the 3D office at it. The
 * camera keys (Controls), the mute button (only while in voice), the 3D panels and the view items
 * (the view dropdown has those) aren't offered. No three.js here: both flat views import it.
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
import { openSignIns } from '../ui/signins';
import { openUpgrade } from '../ui/upgrade';
import { switchView } from '../graphics';
import '../ui/menu.css';
import '../ui/flatchrome.css';

export interface FlatMenuDeps {
  net: Net;
  boardActions: () => BoardActions;
  openWorker: (id: string) => void;
  meeting: () => void;
  /** The next worker waiting on someone. */
  nextWaiting: () => void;
  /** The page has the 3D office's N for it (the 2D view does). */
  nKey?: boolean;
}

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
  const actions: HudAction[] = [
    { ...MENU.waiting, key: d.nKey ? 'N' : undefined, run: d.nextWaiting },
    { ...MENU.issues, run: () => openBoard('issues', net, d.boardActions()) },
    { ...MENU.pulls, run: () => openBoard('pulls', net, d.boardActions()) },
    { ...MENU.queue, run: () => openQueue(net, { openTerminal: d.openWorker }) },
    { ...MENU.services, run: () => openServices() },
    { ...MENU.whiteboard, run: () => openWhiteboard(net) },
    { ...MENU.meeting, run: d.meeting },
    { ...MENU.search, key: undefined, run: () => openSearch((id) => d.openWorker(id)) },
    { ...MENU.docs, shown: () => !!store.floor, run: openDocs },
    // Every floor's card, with how many wait on someone, is the home page.
    { ...MENU.elevator, run: () => location.assign('/home') },
    in3d('roof', 'Up to the roof: a DJ, drinks and the city'),
    in3d('voice', 'Talk with the others in the office'),
    in3d('share', 'Share your screen with the others in the office'),
    in3d('decor', 'Hang a picture on the office wall'),
    { ...MENU.team, run: () => openTeam(net) },
    { ...MENU.accounts, run: () => openAccounts(net) },
    { ...MENU.signins, run: () => openSignIns(net) },
    in3d('settings', 'Your settings, the building and the workers'),
    { ...MENU.home, run: () => location.assign('/home') },
    { ...MENU.upgrade, run: () => openUpgrade(net) },
  ];
  const elsewhere = new Set<string>(['roof', 'voice', 'share', 'decor', 'settings']);
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
      h('p.menu-foot', {}, 'The ones marked 3D ↗ open the 3D office there. The view is in the dropdown by the ☰.'),
    );
    menu = openDropdown(button, el, () => (menu = null));
  }

  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', () => (menu ? menu.close() : open()));
}
