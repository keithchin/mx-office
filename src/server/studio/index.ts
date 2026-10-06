// Studio Pro on the office's machine (studio/open.ts does the opening): what the floor page needs to
// know before it offers the button, and who last opened each floor's project there. Studio Pro
// locks the project while it's open, which is the one-writer rule's business: anything that wants
// to know (a later "Studio mode" that holds the agents' mxcli exec) listens with onStudioOpened.

import { isBusy } from '../../shared/status.js';
import type { Floor } from '../floor.js';
import type { StudioInfo, StudioOpen } from '../../shared/studio.js';
import { checkStudio, machine, type StudioDeps } from './open.js';

export type { StudioInfo, StudioOpen };

const last = new Map<string, StudioOpen>();
const listeners = new Set<(o: StudioOpen) => void>();

/** Hears every time a floor's project is opened in Studio Pro; returns how to stop. */
export function onStudioOpened(fn: (o: StudioOpen) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Who last opened floor `id`'s project in Studio Pro since the office started, if anyone. */
export const lastOpenedInStudio = (id: string): StudioOpen | undefined => last.get(id);

/** Notes that `o.by` opened the project, and tells whoever listens. */
export function studioOpened(o: StudioOpen) {
  last.set(o.floor, o);
  for (const fn of listeners) {
    try {
      fn(o);
    } catch (err) {
      console.error('agent-office: a Studio Pro listener failed', err);
    }
  }
}

/** The agents on `floor` mid-turn, by name. */
export const busyAgents = (floor: Pick<Floor, 'workers'>): string[] =>
  floor.workers
    .list()
    .filter((w) => w.kind === 'agent' && isBusy(w.status))
    .map((w) => w.name);

export function studioInfo(floor: Pick<Floor, 'id' | 'dir' | 'workers'>, admin: boolean, d: StudioDeps = machine()): StudioInfo {
  const c = checkStudio(floor.dir, d);
  const rel = (p: string) => p.slice(floor.dir.length).replace(/^[\\/]+/, '') || p;
  return {
    hasMpr: !!c.mpr,
    ...(c.mpr ? { mpr: rel(c.mpr) } : {}),
    ...(c.version ? { version: c.version } : {}),
    available: !!c.launcher,
    ...(c.problem ? { problem: c.problem, error: c.error } : {}),
    admin,
    busy: busyAgents(floor),
    ...(last.has(floor.id) ? { last: last.get(floor.id) } : {}),
  };
}
