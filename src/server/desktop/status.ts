// What the desktop app's tray asks every half minute (GET /api/desktop/status): the red Needs-you items
// of every project, the same ones the Teams notifications and the phone's pushes post (notify-teams'
// gather.ts: floorNeeds, then redItems with their stable ids), each with the office path its Open goes
// to, and how many agents are mid-turn, for "N agents are working: stop the office and quit?".

import type { Ctx } from '../office/context.js';
import { floorNeeds, redItems } from '../notify-teams/gather.js';
import type { RedItem } from '../notify-teams/cards.js';

export interface DesktopNeed {
  /** Stable across polls and restarts (RedItem.id): what the app dedupes its notifications by. */
  id: string;
  floor: string;
  project: string;
  who: string;
  summary: string;
  urgency: string;
  level: 'block' | 'warn';
  /** The office path its Open goes to, without the leading slash ("lite?floor=…"). */
  path: string;
}

export interface DesktopStatus {
  needs: DesktopNeed[];
  /** Agents mid-turn or starting, across every project. */
  working: number;
  /** Projects whose needs couldn't be read this time. */
  unread?: string[];
}

// redItems builds an Open link only against an address; this one is never shown, only taken off again.
const BASE = 'http://desktop.invalid/';

/** A RedItem as the app gets it: its link made a path again. */
export function desktopNeedOf(r: RedItem): DesktopNeed {
  const path = r.link?.startsWith(BASE) ? r.link.slice(BASE.length) : `lite?floor=${encodeURIComponent(r.floor)}`;
  return { id: r.id, floor: r.floor, project: r.project, who: r.who, summary: r.summary, urgency: r.urgency, level: r.level, path };
}

const BUSY = new Set(['working', 'starting']);

export async function desktopStatus(ctx: Ctx, now = Date.now()): Promise<DesktopStatus> {
  const needs: DesktopNeed[] = [];
  const unread: string[] = [];
  let working = 0;
  for (const floor of ctx.floors.values()) {
    working += floor.workers.list().filter((w) => w.kind === 'agent' && BUSY.has(w.status)).length;
    try {
      const f = await floorNeeds(ctx, floor, now);
      for (const r of redItems(floor, f, BASE)) needs.push(desktopNeedOf(r));
    } catch (err) {
      console.error(`agent-office: desktop status: couldn't read ${floor.id}: ${(err as Error).message}`);
      unread.push(floor.id);
    }
  }
  return { needs, working, ...(unread.length ? { unread } : {}) };
}
