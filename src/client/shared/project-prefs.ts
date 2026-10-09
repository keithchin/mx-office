// What this browser keeps about the projects for its viewer, from the Portal Projects page's cards
// (home/portal.ts): the ones pinned (they come first under "Pinned"), and the ones not watched (the
// 👁 off). An unwatched project doesn't call you over from another floor: it's left out of the "someone's
// waiting on another floor" line (shared/floors.ts) and the tab title's count (shared/title.ts). Every
// project is watched until it's turned off. In this browser's storage only, so it's per viewer; a
// change in one tab reaches the others.

const PINNED = 'agent-office.pinned-projects';
const UNWATCHED = 'agent-office.unwatched-projects';

function read(key: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function write(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    // No storage: just for this visit (the sets below still hold it).
  }
}

let pinned: Set<string> | undefined;
let unwatched: Set<string> | undefined;
const listeners = new Set<() => void>();

if (typeof addEventListener === 'function') {
  addEventListener('storage', (e) => {
    if (e.key !== PINNED && e.key !== UNWATCHED && e.key !== null) return;
    pinned = unwatched = undefined;
    listeners.forEach((fn) => fn());
  });
}

export const isPinned = (floor: string) => (pinned ??= read(PINNED)).has(floor);
export const isWatched = (floor: string) => !(unwatched ??= read(UNWATCHED)).has(floor);

export function setPinned(floor: string, on: boolean) {
  const s = (pinned ??= read(PINNED));
  if (on) s.add(floor);
  else s.delete(floor);
  write(PINNED, s);
  listeners.forEach((fn) => fn());
}

export function setWatched(floor: string, on: boolean) {
  const s = (unwatched ??= read(UNWATCHED));
  if (on) s.delete(floor);
  else s.add(floor);
  write(UNWATCHED, s);
  listeners.forEach((fn) => fn());
}

/** Hears every change, here or in another tab. */
export function onProjectPrefs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
