// The flat views' address says where you are: `?floor=<id>` (and on the 1D view `&tab=<tab>`), so a
// bookmark or a link someone sends opens that floor (and tab) straight away, and the address follows
// along as you change floor or tab. No three.js here: the 1D and 2D views import it.

import { store } from '../state';
import { rememberFloor } from '../state/persist';

const params = () => new URLSearchParams(location.search);

/** The floor the address asked for when the page opened (read once, before the connection goes up). */
export const askedFloor: string | null = params().get('floor');
/** The tab the address asked for when the page opened (the 1D view's Board, Workers, …). */
export const askedTab: string | null = params().get('tab');

// The connection takes the floor you were last on (see net.ts), so the asked one becomes that.
if (askedFloor) rememberFloor(askedFloor);

/** Puts `changes` into the address without a reload or a history entry; null takes a key out. */
export function setAddress(changes: Record<string, string | null>) {
  const q = params();
  for (const [k, v] of Object.entries(changes)) {
    if (v) q.set(k, v);
    else q.delete(k);
  }
  const s = q.toString();
  const url = `${location.pathname}${s ? `?${s}` : ''}${location.hash}`;
  if (url !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', url);
}

/** Keeps `?floor=` on the floor you're on, from now on. */
export function followFloor() {
  const sync = () => store.floor && setAddress({ floor: store.floor });
  store.on('floor', sync);
  sync();
}
