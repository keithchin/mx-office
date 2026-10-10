// An agent's own icon for the Portal Overview's Team and Technical contact cards: its 2D character from the
// waist up, as the office, the team chatter and the escalation cards draw it (pixel/chars.ts: the same look
// from its id, dressed for its role in its team's colour, pixel/teams.ts). Drawn just after the card is on
// the page (each character is a sprite made the first time, ui/pm/escalations.ts), with the initials in the
// circle until then, and kept if the drawing can't be made.

import type { MemberView } from '../../../shared/roster/types';
import type { WorkerInfo } from '../../../shared/protocol';
import { lookFor, standing } from '../../pixel/chars';
import { teamLookup } from '../../pixel/teams';
import { h } from '../dom';

/** The agent's portrait: a 24 px sprite, scaled up pixel-sharp to its circle by the card's CSS. */
export function agentFace(w: Pick<WorkerInfo, 'id' | 'color'>, members: readonly MemberView[] | undefined): HTMLCanvasElement {
  // Decoration: the button or the card beside it says who it is.
  const c = h('canvas.pt-face-px', { width: 24, height: 24, 'aria-hidden': 'true' }) as HTMLCanvasElement;
  setTimeout(() => {
    try {
      const dress = teamLookup(members ?? []).dressFor(w as WorkerInfo);
      c.getContext('2d')?.drawImage(standing(lookFor(w.id, dress.color, dress.outfit), 'front', false, 0), 0, 0, 24, 24, 0, 0, 24, 24);
      c.parentElement?.classList.add('pt-has-px');
    } catch {
      // No canvas here (an old browser, a test): the initials stay.
    }
  }, 0);
  return c;
}
