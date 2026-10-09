/** The tab's title, the same in the 3D office and the 1D view (/lite). No three.js here: the 1D view imports it. */
import { waitingOnSomeone } from '../notify';
import { store } from '../state';
import { isWatched } from './project-prefs';

/** The tab title counts the workers waiting on someone, on every floor you watch (shared/project-prefs.ts), so you can see them from another tab. */
export function renderTitle() {
  const name = store.project?.name;
  const elsewhere = store.floors.reduce((n, f) => n + (f.id === store.floor || !isWatched(f.id) ? 0 : f.waiting), 0);
  const waiting = [...store.workers.values()].filter(waitingOnSomeone).length + elsewhere;
  const title = `${waiting ? `(${waiting}) ` : ''}${name ? `${name} · ` : ''}Agent Office`;
  // Only when it changes: it's worked out on every worker update.
  if (document.title !== title) document.title = title;
}
