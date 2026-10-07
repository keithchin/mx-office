// When the PM console's terminal (term.ts) may draw. xterm's DOM renderer measures each character's
// width by writing it into a hidden span and reading offsetWidth, and keeps a width only when it is
// more than 0. Inside a box that isn't laid out (display: none: the console's Chat view, its
// escalation cards in the screen's place) every width reads 0, so nothing is kept and every row it
// draws forces a layout of the whole page per character: one redraw of a live terminal took seconds
// and froze the 1D Command Center (mx-spike, release 15). So the terminal is only opened (given a
// renderer) while its box has a size; while it hasn't, it's "parked": an xterm that was never opened,
// which still takes in the output (the Chat view's fallback reads its lines) but draws nothing.
// Pure, so a test can pin it.

/** What to do with the terminal now: open it in its box, park it (drop its renderer), or leave it. */
export type TermPlacement = 'open' | 'park' | 'keep';

/** `opened`: it has a renderer now. `box`: its box's size as laid out (0 × 0 when it isn't). */
export function termPlacement(opened: boolean, box: { width: number; height: number }): TermPlacement {
  const shown = box.width > 0 && box.height > 0;
  if (shown && !opened) return 'open';
  if (!shown && opened) return 'park';
  return 'keep';
}
