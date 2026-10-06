// A Lead's subagents at work in the 2D view: a smaller character on an assistant's stool beside its
// Lead's desk (stools.ts), in its team's colour, tapping away at a laptop on its knees while it works,
// tagged "tester (Hedy's)". Idle, it isn't there; benched, it's on a break with the benched Leads
// (subagents.ts puts it on that list). people.ts draws these with everyone else, nearest last.

import { DESK_BY_ID, deskBuilt, DESKS, WING_DESKS } from '../../shared/layout';
import type { WorkerInfo } from '../../shared/protocol';
import { ax, az, type Frame } from './frame';
import { blob, darken, lighten, rect } from './paint';
import { C, sprite } from './sprites';
import { STOOLS, stoolSpot } from './stools';

/** A subagent run at work, as the drawing needs it. */
export interface Helper {
  /** `sub:<floor>:<run id>`: what the pointer finds. */
  id: string;
  /** The subagent's card (`<lead>/<name>`), for its detail. */
  key: string;
  leadWorkerId: string;
  /** "tester (Hedy's)", and what it's on. */
  tag: string;
  task?: string;
  color: string;
}

/** What drawing one needs of people.ts: where to queue it, and where to say it is. */
export interface HelperSink {
  queue(y: number, draw: () => void): void;
  spot(s: { id: string; x: number; y: number; w: number; h: number }): void;
  label(l: { id: string; text: string; x: number; y: number; tag?: { text: string } }): void;
}

// A small person sitting on a stool with a laptop on their knees, facing you: two frames of typing.
// H hair, S skin, K eyes, T shirt (t its shade), L laptop, W its screen's glow, D trousers, O outline.
const BODY = ['....OOOO....', '...OHHHHO...', '..OHHHHHHO..', '..OHSSSSHO..', '..OSKSSKSO..', '...OSSSSO...', '....OSSO....', '..OOTTTTOO..', '.OTTTTTTTTO.'];
const TYPE_A = ['.OTOLLLLOTO.', '.OSOLWWLOSO.', '..OOLLLLOO..', '...ODDDDO...', '...OD..DO...', '...OO..OO...'];
const TYPE_B = ['.OTOLLLLOTO.', '.OTSLWWLSTO.', '..OOLLLLOO..', '...ODDDDO...', '...OD..DO...', '...OO..OO...'];
/** The picture's size: smaller than a worker's 24 by 34. */
export const HELPER_W = 12, HELPER_H = BODY.length + TYPE_A.length;
/** The picture's row the stool's seat is under (the hips). */
const HIPS = 12;

const HAIR = ['#2b2118', '#6d4a2f', '#a8743f', '#1c1c24', '#7a3b2e'];
function hairOf(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return HAIR[n % HAIR.length];
}

function picture(h: Helper, beat: number): HTMLCanvasElement {
  const rows = [...BODY, ...(beat ? TYPE_B : TYPE_A)];
  return sprite(rows, { O: C.ink, H: hairOf(h.key), S: '#ecbf98', K: C.ink, T: h.color, t: darken(h.color, 0.25), L: '#8e9bb0', W: beat ? '#bfefff' : lighten('#7fd6f0', 0.1), D: '#3a4660' });
}

/** Where each Lead's desk is, by its worker. */
function desksOf(workers: Iterable<WorkerInfo>): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of workers) out.set(w.id, w.deskId);
  return out;
}

/**
 * Draws the helpers at work beside their Leads' desks: up to STOOLS per Lead, the last one's tag
 * saying how many more there are. A helper whose Lead isn't at a desk on this floor isn't drawn.
 */
export function drawHelpers(g: CanvasRenderingContext2D, f: Frame, helpers: readonly Helper[], workers: Iterable<WorkerInfo>, now: number, hover: string | null, sink: HelperSink) {
  const deskOf = desksOf(workers);
  const desks = [...DESKS, ...WING_DESKS.filter((d) => deskBuilt(d, f.level))];
  const beat = Math.floor(now / 220) % 2;
  const byLead = new Map<string, Helper[]>();
  for (const h of helpers) byLead.set(h.leadWorkerId, [...(byLead.get(h.leadWorkerId) ?? []), h]);
  for (const [lead, list] of byLead) {
    const desk = DESK_BY_ID.get(deskOf.get(lead) ?? '');
    if (!desk) continue;
    list.slice(0, STOOLS).forEach((h, i) => {
      const at = stoolSpot(desk, i, desks);
      const x = ax(f, at.x), y = az(f, at.z);
      // Sitting on the stool's seat, 5 pixels up, its feet on the rung.
      const seat = y - 5;
      const top = seat - HIPS;
      sink.queue(y, () => {
        blob(g, x, y + 1, 5, 1);
        // The stool: its round seat under the hips, and three legs down to the floor.
        rect(g, x - 4, seat, 9, 2, '#8a6a4a');
        g.drawImage(picture(h, beat), x - (HELPER_W >> 1), top);
        rect(g, x - 4, seat + 2, 1, 4, '#5b4632');
        rect(g, x + 4, seat + 2, 1, 4, '#5b4632');
        rect(g, x, seat + 3, 1, 3, '#4a3828');
        rect(g, x - 3, seat + 4, 7, 1, '#6b5238');
        if (hover === h.id) {
          rect(g, x - 7, y + 3, 15, 1, C.teal);
          rect(g, x - 5, y + 4, 11, 1, 'rgba(23,179,163,0.4)');
        }
      });
      sink.spot({ id: h.id, x: x - 7, y: top - 2, w: 14, h: y - top + 5 });
      const more = i === STOOLS - 1 && list.length > STOOLS ? ` +${list.length - STOOLS}` : '';
      sink.label({ id: h.id, text: `${h.tag}${more}`, x, y: top - 2, ...(h.task ? { tag: { text: h.task } } : {}) });
    });
  }
}
