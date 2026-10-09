// The flat views' address says where you are: `?floor=<id>` (and on the 1D view `&tab=<tab>`), so a
// bookmark or a link someone sends opens that floor (and tab) straight away, and the address follows
// along as you change floor or tab.

import { store } from '../state';
import { lastFloor, rememberFloor } from '../state/persist';
import { flatViewGoesHome } from '../../shared/home';

const params = () => new URLSearchParams(location.search);

/** The floor the address asked for when the page opened (read once, before the connection goes up). */
export const askedFloor: string | null = params().get('floor');
/** The tab the address asked for when the page opened (the 1D view's Board, Workers, …). */
export const askedTab: string | null = params().get('tab');
/** The ⚙️ Settings section the address asked for (`&section=workers`, shared/settings-sections.ts). */
export const askedSection: string | null = params().get('section');
/** The board's team filter (`&teams=design,testing`) and the team page (`&team=testing`) the address asked for (ui/teams/). */
export const askedTeams: string | null = params().get('teams');
export const askedTeam: string | null = params().get('team');

// The connection takes the floor you were last on (see net.ts), so the asked one becomes that.
if (askedFloor) rememberFloor(askedFloor);

/** Puts `changes` into the address without a reload or a history entry; null takes a key out. */
export function setAddress(changes: Record<string, string | null>) {
  const q = params();
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  // Commas stay commas (&teams=design,testing reads better than %2C), which URLSearchParams reads back the same.
  const s = q.toString().replace(/%2C/gi, ',');
  const url = `${location.pathname}${s ? `?${s}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
}

/** Keeps `?floor=` on the floor you're on, from now on. */
export function followFloor() {
  const sync = () => store.floor && setAddress({ floor: store.floor });
  store.on('floor', sync);
  sync();
}

/**
 * Hands over to the home page when this flat view has no floor to open (none asked for, none
 * remembered) or an old `?home` link asked for the floors page (an overlay here once): true when it's on its way there,
 * so the page stops setting itself up.
 */
export function leaveForHome(): boolean {
  if (!flatViewGoesHome(location.search, lastFloor())) return false;
  location.replace('/home');
  return true;
}
