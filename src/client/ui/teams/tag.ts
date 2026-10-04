// A team's tag: its icon and short name in the team's color, on a card, a chip or a heading. The
// colors are theme tokens (teams.css), so the tag follows the Default, Dark and Terminal looks.

import { TEAM_META, type CardTeam } from '../../../shared/roster/card-team';
import { h } from '../dom';
import './teams.css';

/** The small tag on a card. `long` says the team's whole name (a heading, the preview). */
export function teamTag(t: CardTeam, long = false): HTMLElement {
  const m = TEAM_META[t];
  return h('span.tm-tag', { class: `tm-${t}`, title: t === 'unassigned' ? 'No team yet' : `${m.name} team` }, h('span.tm-ico', { 'aria-hidden': 'true' }, m.icon), long ? m.name : m.short);
}
