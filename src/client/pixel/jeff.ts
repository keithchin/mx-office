// Jeff, the Router, as the 2D view draws him (router-room.ts puts him in his room): the people's own
// character (chars.ts, outfit 'router': charcoal suit, tie, glasses, a moustache), seated facing you,
// with what he does on top: now and then he adjusts his glasses or sips his coffee, and when he makes a
// judgement he raises his stamp and brings it down.

import { JEFF_LOOK, seated } from './chars';
import { rect } from './paint';

/** What he's doing this frame. */
export type JeffAct = 'still' | 'glasses' | 'sip' | 'stamp-up' | 'stamp-down';

/** A stamp lasts this long after a judgement: up, then down. */
export const STAMP_MS = 900;
const CYCLE_MS = 9000;

/** His idle act at `now`, or the stamp when a judgement was `since` ms ago. */
export function jeffAct(now: number, since: number | undefined): JeffAct {
  if (since !== undefined && since < STAMP_MS) return since < STAMP_MS * 0.45 ? 'stamp-up' : 'stamp-down';
  const t = now % CYCLE_MS;
  if (t < 900) return 'glasses';
  if (t > 4200 && t < 5800) return 'sip';
  return 'still';
}

const SUIT = '#3a3f4b', SUIT_L = '#545a68', SKIN = JEFF_LOOK.skin, MUG = '#f4f6fa';

/** Jeff seated with his top-left at (x, y), 24 art pixels across, acting out `act`. */
export function drawJeff(g: CanvasRenderingContext2D, x: number, y: number, act: JeffAct, breath: boolean) {
  const top = y + (breath ? 1 : 0);
  g.drawImage(seated(JEFF_LOOK, 'front', 'still', 0), x, top);
  const p = (px: number, py: number, w: number, h: number, c: string) => rect(g, x + px, top + py, w, h, c);
  if (act === 'glasses') {
    // His right hand up to the bridge of his glasses.
    p(17, 13, 3, 6, SUIT_L);
    p(14, 11, 3, 3, SUIT_L);
    p(11, 9, 3, 2, SKIN);
  } else if (act === 'sip') {
    // His mug to his lips, steam over it.
    p(3, 14, 3, 6, SUIT_L);
    p(5, 12, 3, 3, SUIT_L);
    p(8, 11, 5, 4, MUG);
    p(8, 11, 5, 1, '#c5cedb');
    p(7, 12, 1, 2, MUG);
    p(9, 8, 1, 2, 'rgba(255,255,255,0.7)');
    p(11, 7, 1, 2, 'rgba(255,255,255,0.5)');
  } else if (act === 'stamp-up') {
    // The stamp held up high on his right.
    p(19, 6, 3, 12, SUIT);
    p(19, 6, 1, 12, SUIT_L);
    p(19, 3, 3, 3, SKIN);
    p(18, 0, 5, 3, '#8a5a35');
    p(17, -2, 7, 2, '#c0392b');
  }
  // stamp-down: the stamp is on the desk (router-room.ts draws it there with its mark).
}
