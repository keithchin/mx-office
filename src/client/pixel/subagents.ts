// The Leads' subagents in the 2D view (pixel.ts), those that have run at least once: each run at work on
// a stool behind its Lead's chair, every other one about the office, idle or benched (helpers.ts,
// helper-life.ts), their hover cards, and their detail on a click (ui/subagents/detail.ts). From the
// floor's team as teams.ts has it, worked out once per roster rather than every frame.

import { floorHelpers, subagentCards, type FloorHelper, type SubagentCard } from '../../shared/roster/subagent-cards';
import { ZONE_BY_TEAM } from '../../shared/zones';
import type { RosterView } from '../../shared/roster/types';
import { clip, h } from '../ui/dom';
import { openSubagentDetail } from '../ui/subagents/detail';
import type { Helper } from './helpers';

const AT_WORK = 'sub:';
const ABOUT = 'subi:';
const colorOf = (c: Pick<SubagentCard, 'team'>) => ZONE_BY_TEAM.get(c.team)?.color ?? '#8fa3bf';

/** The floor's subagents as the drawing takes them (helpers.ts); the home page's overview makes them from its floors too. */
export const asHelpers = (list: readonly FloorHelper[], floor: string): Helper[] =>
  list.map((x) => ({
    id: x.runId ? `${AT_WORK}${floor}:${x.runId}` : `${ABOUT}${floor}:${x.key}`,
    key: x.key,
    ...(x.leadWorkerId ? { leadWorkerId: x.leadWorkerId } : {}),
    tag: x.tag,
    ...(x.task ? { task: clip(x.task, 40) } : {}),
    color: colorOf(x),
    state: x.state,
  }));

let memo: { v: RosterView | null; floor: string | null; cards: SubagentCard[]; helpers: Helper[] } | undefined;
/** The floor's cards (never-run ones too, for the hover card and detail of any) and its helpers, worked out again only when the team changed. */
function worked(v: RosterView | null, floor: string | null) {
  if (memo?.v !== v || memo.floor !== floor) {
    const cards = v ? subagentCards(v, { includeNeverRun: true }) : [];
    memo = { v, floor, cards, helpers: v && floor ? asHelpers(floorHelpers(cards), floor) : [] };
  }
  return memo;
}

/** The floor's subagents that have run, for the drawing. */
export const helpersOf = (v: RosterView | null, floor: string | null): Helper[] => worked(v, floor).helpers;

/** Whether a spot's id is one of these. */
export const isSubagentId = (id: string) => id.startsWith(AT_WORK) || id.startsWith(ABOUT);

/** The subagent card a spot is, if it's one. */
function cardAt(v: RosterView | null, id: string): { card: SubagentCard; task?: string } | undefined {
  if (!v || !isSubagentId(id)) return undefined;
  const { cards } = worked(v, memo?.floor ?? null);
  if (id.startsWith(ABOUT)) {
    const key = id.slice(id.indexOf(':', ABOUT.length) + 1);
    const card = cards.find((c) => c.key === key);
    return card && { card };
  }
  const run = id.slice(id.indexOf(':', AT_WORK.length) + 1);
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
  const last = c.lastTask ? `Last: ${clip(c.lastTask, 80)}` : '';
  return [
    h('b', {}, `🧩 ${c.name}`, h('span.pill', { class: c.status === 'working' ? 'working' : 'idle' }, c.status)),
    h('div.px-role', { style: `--team: ${colorOf(c)}` }, `Subagent · hired by ${c.hiredBy}`),
    at.task ? h('div.px-task', {}, at.task) : c.benchReason ? h('div', {}, `🪑 ${clip(c.benchReason, 120)}`) : last ? h('div.px-dim', {}, last) : null,
    h('div.px-dim', {}, [c.model, `${c.runs} run${c.runs === 1 ? '' : 's'}`, c.unreviewed ? `${c.unreviewed} unreviewed` : '', c.grade ? `grade ${c.grade}` : 'not graded yet'].filter(Boolean).join(' · ')),
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
