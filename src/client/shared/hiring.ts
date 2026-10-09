/**
 * Hiring, as the 1D view (/lite) does it.
 */
import { store } from '../state';

/** The building's other projects a new worker can work in too, each in a worktree of its own (see WorkerInfo.repos). */
export function repoChoices(): { id: string; name: string }[] {
  return store.floors.filter((f) => f.id !== store.floor && f.branch && !f.cloning).map((f) => ({ id: f.id, name: f.name }));
}
