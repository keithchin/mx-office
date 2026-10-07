// A Lead's subagents in the 2D view, smaller than the workers and tagged "Nia (Hedy's tester)". At work, one
// sits on an assistant's stool behind its Lead's chair (stools.ts), in its team's colour, tapping at a
// laptop on its knees. Idle, it lives about the office like a benched Lead (helper-life.ts): the lounge
// TV, a smoke on the balcony, a coffee in the kitchen, a word with whoever's close by; benched, the same
// with a 🪑 tag. When a run starts it walks back to its stool, and away again when it ends.
// people.ts draws these with everyone else, nearest last.

import { DESK_BY_ID, deskBuilt, DESKS, WING_DESKS } from '../../shared/layout';
import type { WorkerInfo } from '../../shared/protocol';
import { ax, az, type Frame } from './frame';
import { blob, darken, lighten, rect } from './paint';
import { C, sprite } from './sprites';
import { STOOLS, stoolSpot } from './stools';
import { breakAt, type BreakLead } from './breaks';
import { chatting, idleSpot, Walks, type LifeSpot } from './helper-life';

/** A subagent as the drawing needs it. */
export interface Helper {
  /** `sub:<floor>:<run id>` at work, `subi:<floor>:<card key>` otherwise: what the pointer finds. */
  id: string;
  /** The subagent's card (`<lead>/<name>`), for its detail; also who it is about the office. */
  key: string;
  leadWorkerId?: string;
  /** "Nia (Hedy's tester)", and what it's on. */
  tag: string;
  task?: string;
  color: string;
  state: 'working' | 'idle' | 'benched';
}

/** What drawing one needs of people.ts: where to queue it, and where to say it is. */
export interface HelperSink {
  queue(y: number, draw: () => void): void;
  spot(s: { id: string; x: number; y: number; w: number; h: number }): void;
  label(l: { id: string; text: string; x: number; y: number; status: string; tag?: { text: string; color?: string } }): void;
}

/** The rest of the scene the helpers live in: the benched Leads on their breaks, the clock, less motion, and where each was drawn. */
export interface HelperWorld {
  leads: readonly BreakLead[];
  clock: number;
  still: boolean;
  walks: Walks;
}

// Small people, 12 across. H hair, S skin, K eyes, T shirt (t its shade), L laptop, W its screen's glow,
// D trousers, O outline, M a mug, G a cigarette's glow.
const BODY = ['....OOOO....', '...OHHHHO...', '..OHHHHHHO..', '..OHSSSSHO..', '..OSKSSKSO..', '...OSSSSO...', '....OSSO....', '..OOTTTTOO..', '.OTTTTTTTTO.'];
const TYPE_A = ['.OTOLLLLOTO.', '.OSOLWWLOSO.', '..OOLLLLOO..', '...ODDDDO...', '...OD..DO...', '...OO..OO...'];
const TYPE_B = ['.OTOLLLLOTO.', '.OTSLWWLSTO.', '..OOLLLLOO..', '...ODDDDO...', '...OD..DO...', '...OO..OO...'];
const STAND = ['.OTTTTTTTTO.', '.OSTTTTTTSO.', '..OTTTTTTO..', '...ODDDDO...', '...OD..DO...', '...OD..DO...', '...OO..OO...'];
const STEP = ['.OTTTTTTTTO.', '.OSTTTTTTSO.', '..OTTTTTTO..', '...ODDDDO...', '..OD...DO...', '..OD....DO..', '..OO....OO..'];
const MUG = ['.OTTTTTTTTO.', '.OSTTTTTTMM.', '..OTTTTTTMM.', '...ODDDDO...', '...OD..DO...', '...OD..DO...', '...OO..OO...'];
const SMOKE = ['.OTTTTTTTTO.', '.OSTTTTTTSG.', '..OTTTTTTO..', '...ODDDDO...', '...OD..DO...', '...OD..DO...', '...OO..OO...'];
const COUCH = ['.OTTTTTTTTO.', '.OSTTTTTTSO.', '..ODDDDDDO..', '..OOOOOOOO..'];
const BACK_HEAD = ['....OOOO....', '...OHHHHO...', '..OHHHHHHO..', '..OHHHHHHO..', '..OHHHHHHO..', '...OHHHHO...', '....OSSO....', '..OOTTTTOO..', '.OTTTTTTTTO.'];
/** The picture's size: smaller than a worker's 24 by 34. */
export const HELPER_W = 12, HELPER_H = BODY.length + TYPE_A.length;
/** The picture's row the stool's seat is under (the hips). */
const HIPS = 12;
const BUBBLE = ['.OOOOOO.', 'OWWWWWWO', 'OWKWKWKO', 'OWWWWWWO', '.OOOOOO.', '..OO....'];

const HAIR = ['#2b2118', '#6d4a2f', '#a8743f', '#1c1c24', '#7a3b2e'];
function hairOf(id: string): string {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return HAIR[n % HAIR.length];
}

function picture(h: Helper, rows: readonly string[], beat = 0): HTMLCanvasElement {
  return sprite(rows, { O: C.ink, H: hairOf(h.key), S: '#ecbf98', K: C.ink, T: h.color, t: darken(h.color, 0.25), L: '#8e9bb0', W: beat ? '#bfefff' : lighten('#7fd6f0', 0.1), D: '#3a4660', M: '#f4f1ea', G: '#ff8a3d' });
}

/** Where each Lead's desk is, by its worker. */
function desksOf(workers: Iterable<WorkerInfo>): Map<string, string> {
  const out = new Map<string, string>();
  for (const w of workers) out.set(w.id, w.deskId);
  return out;
}

/** The walks of the 2D view's own floor (the overview keeps one per floor). */
export const floorWalks = new Walks();

/**
 * Draws the floor's subagents: up to STOOLS at work per Lead on their stools (the last one's tag says how
 * many more), every other one about the office. One at work whose Lead isn't at a desk here is about the
 * office too.
 */
export function drawHelpers(g: CanvasRenderingContext2D, f: Frame, helpers: readonly Helper[], workers: Iterable<WorkerInfo>, now: number, hover: string | null, world: HelperWorld, sink: HelperSink) {
  const deskOf = desksOf(workers);
  const desks = [...DESKS, ...WING_DESKS.filter((d) => deskBuilt(d, f.level))];
  const beat = Math.floor(now / 220) % 2;
  const stoolOf = new Map<string, { i: number; of: number }>();
  const perLead = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const h of helpers) if (h.state === 'working' && h.leadWorkerId) counts.set(h.leadWorkerId, (counts.get(h.leadWorkerId) ?? 0) + 1);
  // Who walks where: the first run at work of a subagent is the same character as it idle (its card's key).
  const firsts = new Set<string>();
  const placed: { h: Helper; at: LifeSpot; walkKey: string; i?: number; of?: number }[] = [];
  let k = world.leads.length;
  for (const h of helpers) {
    const desk = h.state === 'working' && h.leadWorkerId ? DESK_BY_ID.get(deskOf.get(h.leadWorkerId) ?? '') : undefined;
    const walkKey = firsts.has(h.key) ? h.id : h.key;
    firsts.add(h.key);
    let target: LifeSpot;
    if (desk) {
      const i = perLead.get(h.leadWorkerId!) ?? 0;
      perLead.set(h.leadWorkerId!, i + 1);
      if (i >= STOOLS) continue;
      const s = stoolSpot(desk, i, desks);
      stoolOf.set(h.id, { i, of: counts.get(h.leadWorkerId!) ?? 1 });
      target = { x: s.x, z: s.z, act: 'stool', walking: false, pose: 'front', at: 0 };
    } else target = idleSpot(h.key, k++, world.clock, world.still);
    placed.push({ h, at: world.walks.place(walkKey, target, now, world.still), walkKey });
  }
  world.walks.keep(new Set(placed.map((p) => p.walkKey)));
  // A word with whoever else is standing about close by: other subagents and the benched Leads.
  const talking = chatting([
    ...placed.map((p) => ({ id: p.h.id, x: p.at.x, z: p.at.z, busy: p.at.walking || p.at.act === 'stool' })),
    ...world.leads.map((l, i) => {
      const s = breakAt(l.name, i, world.clock, world.still);
      return { id: l.id, x: s.x, z: s.z, busy: s.walking };
    }),
  ]);

  for (const { h, at } of placed) {
    const x = ax(f, at.x), y = az(f, at.z);
    const seated = at.act === 'stool' && !at.walking;
    const couch = at.act === 'tv' && !at.walking;
    const seat = y - 5;
    const top = seated ? seat - HIPS : couch ? y - 3 - BODY.length - COUCH.length + 2 : y - BODY.length - STAND.length + 1;
    sink.queue(y, () => {
      blob(g, x, y + 1, 5, 1);
      if (seated) {
        // The stool: its round seat under the hips, and three legs down to the floor.
        rect(g, x - 4, seat, 9, 2, '#8a6a4a');
        g.drawImage(picture(h, [...BODY, ...(beat ? TYPE_B : TYPE_A)], beat), x - (HELPER_W >> 1), top);
        rect(g, x - 4, seat + 2, 1, 4, '#5b4632');
        rect(g, x + 4, seat + 2, 1, 4, '#5b4632');
        rect(g, x, seat + 3, 1, 3, '#4a3828');
        rect(g, x - 3, seat + 4, 7, 1, '#6b5238');
      } else {
        const head = at.pose === 'back' ? BACK_HEAD : BODY;
        const rest = couch ? COUCH : at.walking ? (beat ? STEP : STAND) : at.act === 'coffee' ? MUG : at.act === 'smoke' ? SMOKE : STAND;
        if (h.state === 'benched') g.globalAlpha = 0.85;
        g.drawImage(picture(h, [...head, ...rest]), x - (HELPER_W >> 1), top);
        g.globalAlpha = 1;
        // A wisp of smoke, or steam off the mug, now and then.
        if (!at.walking && (at.act === 'smoke' || at.act === 'coffee') && Math.floor((now + at.at) / 700) % 3 === 0) rect(g, x + 5, top + 6 - (beat ? 1 : 0), 1, 2, 'rgba(230,236,245,0.8)');
      }
      if (talking.has(h.id) && !at.walking) g.drawImage(sprite(BUBBLE, { O: C.ink, W: '#ffffff', K: Math.floor(now / 500) % 2 ? C.ink : '#9aa7bd' }), x + 3, top - 7);
      if (hover === h.id) {
        rect(g, x - 7, y + 3, 15, 1, C.teal);
        rect(g, x - 5, y + 4, 11, 1, 'rgba(23,179,163,0.4)');
      }
    });
    sink.spot({ id: h.id, x: x - 7, y: top - 2, w: 14, h: y - top + 5 });
    const st = stoolOf.get(h.id);
    const more = st && st.i === STOOLS - 1 && st.of > STOOLS ? ` +${st.of - STOOLS}` : '';
    const tag = h.state === 'benched' ? { text: '🪑 benched', color: '#9aa7bd' } : seated && h.task ? { text: h.task } : undefined;
    sink.label({ id: h.id, text: `${h.tag}${more}`, x, y: top - 2, status: h.state === 'working' ? 'working' : 'idle', ...(tag ? { tag } : {}) });
  }
}
