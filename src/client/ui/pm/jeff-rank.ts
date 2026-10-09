// Jeff's order on the escalation lists (the console's "Escalations to you", the approvals, the
// Needs-you strip): the chip that goes beside a card, never inside it, and the note above a list he
// sorted. The order itself is shared/roster/jeff-rank.ts.

import { rankChip, rankOf, rankTip, SORTED_NOTE } from '../../../shared/roster/jeff-rank';
import type { Escalation } from '../../../shared/roster/escalation';
import { h } from '../dom';
import './jeff-rank.css';

/** "🧑‍⚖️ #1 · resolve first" for an escalation Jeff ranked, or null. */
export function rankChipEl(e: Escalation): HTMLElement | null {
  const n = rankOf(e);
  if (n === undefined || !e.jeffRank) return null;
  const tip = rankTip(e.jeffRank, n);
  return h('span.jrank-chip', { class: `jrank-${n}`, title: tip, 'aria-label': tip, 'data-rank': String(n) }, rankChip(n));
}

/** The one line above a list in Jeff's order. */
export const sortedNote = () => h('p.jrank-note', { role: 'note' }, SORTED_NOTE);
