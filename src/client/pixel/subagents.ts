// The Leads' subagents in the 2D view (pixel.ts): each run at work as a helper on a stool beside its
// Lead's desk (helpers.ts), each benched one on a break with the benched Leads (breaks.ts), their hover
// cards, and their detail on a click (ui/subagents/detail.ts). From the floor's team as teams.ts has it.

import { subagentCards, workingHelpers, type SubagentCard, type WorkingHelper } from '../../shared/roster/subagent-cards';
import { ZONE_BY_TEAM } from '../../shared/zones';
import type { RosterView } from '../../shared/roster/types';
import { clip, h } from '../ui/dom';
import { openSubagentDetail } from '../ui/subagents/detail';
import type { BreakLead } from './breaks';
import type { Helper } from './helpers';

const HELPER = 'sub:';
const BENCHED = 'subb:';
const colorOf = (c: Pick<SubagentCard, 'team'>) => ZONE_BY_TEAM.get(c.team)?.color ?? '#8fa3bf';

/** Runs at work as the drawing takes them (helpers.ts); the home page's overview makes them from its floors too. */
export const asHelpers = (list: readonly WorkingHelper[], floor: string): Helper[] =>
  list.map((x) => ({ id: `${HELPER}${floor}:${x.runId}`, key: x.key, leadWorkerId: x.leadWorkerId, tag: x.tag, ...(x.task ? { task: clip(x.task, 40) } : {}), color: colorOf(x) }));

/** The floor's subagent runs at work, as helpers beside their Leads' desks. */
export function helpersOf(v: RosterView | null, floor: string | null): Helper[] {
  if (!v || !floor) return [];
  return asHelpers(workingHelpers(subagentCards(v)), floor);
}

/** The floor's benched subagents, on a break about the office like benched Leads. */
export function benchedSubagents(v: RosterView | null, floor: string | null): BreakLead[] {
  if (!v || !floor) return [];
  return subagentCards(v)
    .filter((c) => c.status === 'benched')
    .map((c) => ({ id: `${BENCHED}${floor}:${c.key}`, name: c.tag, title: `subagent, hired by ${c.hiredBy}`, outfit: 'plain' as const, color: colorOf(c) }));
}

/** Whether a spot's id is one of these. */
export const isSubagentId = (id: string) => id.startsWith(HELPER) || id.startsWith(BENCHED);

/** The subagent card a spot is, if it's one. */
function cardAt(v: RosterView | null, id: string): { card: SubagentCard; task?: string } | undefined {
  if (!v || !isSubagentId(id)) return undefined;
  const cards = subagentCards(v);
  if (id.startsWith(BENCHED)) {
    const key = id.slice(id.indexOf(':', BENCHED.length) + 1);
    const card = cards.find((c) => c.key === key);
    return card && { card };
  }
  const run = id.slice(id.indexOf(':', HELPER.length) + 1);
  for (const card of cards) {
    const r = card.working.find((x) => x.id === run);
    if (r) return { card, task: r.task };
  }
  return undefined;
}

/** A subagent's hover card. */
export function subagentTip(v: RosterView | null, id: string): HTMLElement[] | null {
  const at = cardAt(v, id);
  if (!at) return null;
  const c = at.card;
  return [
    h('b', {}, `🧩 ${c.name}`, h('span.pill', { class: c.status === 'working' ? 'working' : 'idle' }, c.status === 'working' ? 'working' : c.status)),
    h('div.px-role', { style: `--team: ${colorOf(c)}` }, `Subagent · hired by ${c.hiredBy}`),
    at.task ? h('div.px-task', {}, at.task) : c.benchReason ? h('div', {}, `🪑 ${clip(c.benchReason, 120)}`) : null,
    h('div.px-dim', {}, [c.model, `${c.runs} run${c.runs === 1 ? '' : 's'}`, c.grade ? `grade ${c.grade}` : 'not graded yet'].join(' · ')),
    h('div.px-hint', {}, '🖱️ Its runs and reviews'),
  ].filter((x): x is HTMLElement => !!x);
}

/** Opens a subagent's detail, from its spot. True when it was one. */
export function openSubagentAt(v: RosterView | null, id: string, openWorker: (id: string) => void, onRoster: (v: RosterView) => void): boolean {
  const at = cardAt(v, id);
  if (!at || !v) return false;
  openSubagentDetail(v, at.card.key, { openWorker, onRoster });
  return true;
}
