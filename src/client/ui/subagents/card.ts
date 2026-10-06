// A Lead's subagents as cards in the 👷 Workers tab (ui/ranking/), each right after its Lead's card:
// "🧩 tester · hired by Hedy (Lead Tester)", its model, how it is now (at work on what, benched, or when
// it last ran), its runs and its grade A–F. A Lead that isn't on the list (not at work on this floor)
// has its subagents in a group of their own at the end. Clicking one opens its detail (detail.ts).
// No three.js: the 1D view imports it.

import { cardNow, type SubagentCard } from '../../../shared/roster/subagent-cards';
import { modelWord } from '../../../shared/roster/subagents';
import { h } from '../dom';
import { gradeBadge } from '../ranking/view';
import './subagents.css';

const PILL: Record<SubagentCard['status'], string> = { working: '🔨 Working', idle: '💤 Idle', benched: '🪑 Benched' };

/** One subagent's card; `open` shows its detail. */
export function subagentCardEl(c: SubagentCard, now: number, open: (c: SubagentCard) => void): HTMLElement {
  const sub = [
    `🧠 ${modelWord(c.model)}`,
    `${c.runs} run${c.runs === 1 ? '' : 's'}`,
    c.state === 'warning' ? `⚠️ on warning` : '',
    c.underperforming ? `📉 ${c.why ?? 'underperforming'}` : '',
  ].filter(Boolean);
  return h(
    'li.lite-worker.rk-item.sw-card',
    { class: `sw-${c.status}`, 'data-subagent': c.key },
    gradeBadge(c.grade, c.score),
    h(
      'button.lite-card',
      { type: 'button', onclick: () => open(c), 'aria-label': `${c.name}, a subagent hired by ${c.hiredBy}: ${PILL[c.status]}. Open its runs and reviews` },
      h('span.sw-icon', { 'aria-hidden': 'true' }, '🧩'),
      h('span.lite-info', {}, h('span.lite-name', {}, c.name, h('span.sw-hired', {}, ` · hired by ${c.hiredBy}`)), h('span.lite-now', {}, cardNow(c, now)), h('span.lite-sub', {}, sub.join(' · '))),
      h('span.lite-state', {}, h('span.sw-pill', { class: `sw-${c.status}` }, PILL[c.status])),
    ),
  );
}

/**
 * Puts the subagents' cards in the list: each Lead's right after its card (`[data-worker]`), the rest in a
 * group at the end, before the "how it's graded" footer.
 */
export function nestSubagents(list: HTMLElement, cards: readonly SubagentCard[], now: number, open: (c: SubagentCard) => void) {
  const loose: HTMLElement[] = [];
  const after = new Map<string, Element>();
  for (const c of cards) {
    const el = subagentCardEl(c, now, open);
    const anchor = c.leadWorkerId ? (after.get(c.leadWorkerId) ?? list.querySelector(`[data-worker="${CSS.escape(c.leadWorkerId)}"]`)) : null;
    if (anchor) {
      anchor.after(el);
      after.set(c.leadWorkerId!, el);
    } else loose.push(el);
  }
  if (!loose.length) return;
  const foot = list.querySelector(':scope > .rk-how-li');
  const group = [h('li.rk-group-h.sw-group-h', {}, h('span', {}, '🧩 Subagents of Leads not at work here'), h('small', {}, `${loose.length}`)), ...loose];
  if (foot) foot.before(...group);
  else list.append(...group);
}
