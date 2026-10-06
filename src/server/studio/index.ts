// Studio Pro on the office's machine (studio/open.ts does the opening): what the floor page needs to
// know before it offers the button, and who last opened each floor's project there. Studio Pro
// locks the project while it's open, which is the one-writer rule's business: Studio mode
// (watch.ts, started here by startStudioMode) sees it open or close however it was opened, and
// pauses the agents' mxcli writes meanwhile (guard.ts).

import { isBusy } from '../../shared/status.js';
import type { Floor } from '../floor.js';
import type { StudioInfo, StudioOpen, StudioState } from '../../shared/studio.js';
import { audit } from '../audit/index.js';
import { noteChatter } from '../chatter/bus.js';
import type { Ctx } from '../office/context.js';
import { checkStudio, machine, type StudioDeps } from './open.js';
import { POLL_MS, StudioWatch, machineWatchDeps } from './watch.js';

export type { StudioInfo, StudioOpen };

let watch: StudioWatch | undefined;

/** Floor `id`'s Studio mode, once the office has looked. */
export const studioStateOf = (id: string): StudioState | undefined => watch?.stateOf(id);

/**
 * Starts Studio mode: a look at the Mendix floors every few seconds (and soon after someone opens
 * one from the floor page), telling each floor's browsers when it changes. Returns what stops it.
 */
export function startStudioMode(ctx: Pick<Ctx, 'floors' | 'toFloor' | 'toastFloor'>): () => void {
  const d = machine();
  const w = new StudioWatch(
    machineWatchDeps(
      {
        state: (f, state) => {
          const floor = ctx.floors.get(f.id);
          if (floor) ctx.toFloor(floor, { t: 'studio.state', state });
        },
        audit: (e) => audit.record(e),
        chatter: (floor, draft) => noteChatter(floor, draft),
        toast: (f, text, level) => ctx.toastFloor(ctx.floors.get(f.id), text, level),
      },
      { findMpr: d.findMpr, readVersion: d.readVersion },
    ),
  );
  watch = w;
  const look = () => void w.poll(ctx.floors.values()).catch((err) => console.error('agent-office: Studio mode failed to look', err));
  const timer = setInterval(look, POLL_MS);
  timer.unref?.();
  const soon = new Set<NodeJS.Timeout>();
  // Opened from the floor page: Studio Pro takes a few seconds to start, so look again shortly.
  const off = onStudioOpened(() => {
    for (const ms of [3000, 8000, 15000]) {
      const t = setTimeout(() => {
        soon.delete(t);
        look();
      }, ms);
      soon.add(t);
    }
  });
  look();
  return () => {
    clearInterval(timer);
    for (const t of soon) clearTimeout(t);
    off();
    if (watch === w) watch = undefined;
  };
}

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
    ...(studioStateOf(floor.id) ? { state: studioStateOf(floor.id) } : {}),
  };
}
