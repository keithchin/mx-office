// An agent's own icon for the Portal Overview's Team card: its 2D character from the waist up, as the office,
// the team chatter and the escalation cards draw it (pixel/chars.ts: the same look from its id, dressed for
// its role in its team's colour, pixel/teams.ts). Drawn after the card is on the page, one face a frame at
// most (each character is a sprite made the first time, which costs a few tens of ms on a busy page: the
// performance guard, as ui/pm/escalations.ts does it), with the initials in the circle until then, and kept
// if the drawing can't be made.

import type { MemberView } from '../../../shared/roster/types';
import type { WorkerInfo } from '../../../shared/protocol';
import { lookFor, standing } from '../../pixel/chars';
import { teamLookup } from '../../pixel/teams';
import { h } from '../dom';

/** Faces still to draw, and the time a frame may spend on them. */
const pending: (() => void)[] = [];
const FACE_MS = 8;
function drain() {
  const end = performance.now() + FACE_MS;
  // At least one a frame, however long it takes; more while there's time left.
  do pending.shift()!();
  while (pending.length && performance.now() < end);
  if (pending.length) requestAnimationFrame(drain);
}

/** The agent's portrait: a 24 px sprite, scaled up pixel-sharp to its circle by the card's CSS. */
export function agentFace(w: Pick<WorkerInfo, 'id' | 'color'>, members: readonly MemberView[] | undefined): HTMLCanvasElement {
  // Decoration: the button or the card beside it says who it is.
  const c = h('canvas.pt-face-px', { width: 24, height: 24, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  pending.push(() => {
    if (!c.isConnected) return; // redrawn meanwhile: this one's gone
    try {
      const dress = teamLookup(members ?? []).dressFor(w as WorkerInfo);
      c.getContext('2d')?.drawImage(standing(lookFor(w.id, dress.color, dress.outfit), 'front', false, 0), 0, 0, 24, 24, 0, 0, 24, 24);
      c.parentElement?.classList.add('pt-has-px');
    } catch {
      // No canvas here (an old browser, a test): the initials stay.
    }
  });
  if (pending.length === 1) requestAnimationFrame(drain);
  return c;
}
