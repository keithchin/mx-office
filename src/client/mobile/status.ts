// The phone version's Status tab: a compact card per project (GET /api/m/status): who's working, asking
// or asleep, the toolkit gate or stage it's at, open escalations, the team's spend against its cap (the
// Budget feature's chip goes in that slot), and its buttons: go there, Raise cap, Hire, and Pause /
// Resume (a slot until the office has them).

import { statusWords, type ProjectStatus } from '../../shared/mobile';
import type { RosterView } from '../../shared/roster/types';
import { h } from '../ui/dom';

export interface StatusActions {
  go(floor: string): void;
  raiseCap(p: ProjectStatus): void;
  hire(p: ProjectStatus): void;
  pause(p: ProjectStatus): void;
}

const money = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`;

/** The spend chip: today's spend and the cap (the Budget feature's own chip replaces it once it lands). */
function spendChip(p: ProjectStatus): HTMLElement | null {
  if (!p.spend) return null;
  const { usd, cap } = p.spend;
  const pct = cap ? usd / cap : 0;
  return h('span.m-chip.m-spend', { class: pct >= 1 ? 'm-chip-bad' : pct >= 0.8 ? 'm-chip-warn' : '', 'data-slot': 'budget', title: cap ? `Spent today ${money(usd)} of the ${money(cap)} daily team cap` : `Spent today ${money(usd)}; no daily cap at this level` }, cap ? `💸 ${money(usd)} / ${money(cap)}` : `💸 ${money(usd)}`);
}

export function statusCard(p: ProjectStatus, here: boolean, roster: RosterView | undefined, act: StatusActions): HTMLElement {
  const canHire = here && roster?.admin && roster.members.some((m) => m.status === 'not-hired' || m.status === 'benched');
  return h(
    'article.m-card.m-status',
    { class: here ? 'm-here' : '', 'data-floor': p.floor },
    h(
      'header.m-status-head',
      {},
      h('h3', {}, p.name),
      here ? h('span.m-chip.m-chip-here', {}, 'You’re here') : h('button.btn.small', { type: 'button', onclick: () => act.go(p.floor) }, 'Go'),
    ),
    h(
      'p.m-status-line',
      {},
      p.asking ? h('span.m-dot.m-dot-ask', { 'aria-hidden': 'true' }) : p.working ? h('span.m-dot.m-dot-work', { 'aria-hidden': 'true' }) : h('span.m-dot', { 'aria-hidden': 'true' }),
      statusWords(p),
    ),
    h(
      'div.m-chips',
      {},
      p.escalations ? h('span.m-chip.m-chip-bad', {}, `🚩 ${p.escalations} escalation${p.escalations === 1 ? '' : 's'}`) : null,
      spendChip(p),
      p.projectPaused ? h('span.m-chip.m-chip-warn', {}, '⏸ Paused') : null,
    ),
    p.stage ? h('p.m-stage', {}, `🧭 ${p.stage}`) : null,
    p.paused ? h('p.m-warn', {}, `💸 ${p.paused}`) : null,
    h(
      'div.m-acts',
      {},
      p.paused || p.spend?.cap ? h('button.btn.small', { type: 'button', onclick: () => act.raiseCap(p) }, '💸 Raise cap') : null,
      canHire ? h('button.btn.small', { type: 'button', onclick: () => act.hire(p) }, '➕ Hire') : null,
      // Pause / Resume project: a slot until the office has the feature (it answers "not yet").
      h('button.btn.small.m-slot', { type: 'button', title: 'Pause or resume this project (coming)', onclick: () => act.pause(p) }, p.projectPaused ? '▶ Resume' : '⏸ Pause'),
    ),
  );
}

export function statusList(list: readonly ProjectStatus[] | undefined, floor: string | undefined, roster: RosterView | undefined, act: StatusActions, error?: string): HTMLElement[] {
  if (error) return [h('p.m-empty', {}, `Couldn’t load the status: ${error}`)];
  if (!list) return [h('p.m-empty', {}, 'Loading…')];
  if (!list.length) return [h('p.m-empty', {}, 'No projects yet. Add one from the home page on a computer.')];
  const sorted = [...list].sort((a, b) => (a.floor === floor ? -1 : b.floor === floor ? 1 : b.asking + b.escalations - (a.asking + a.escalations)));
  return sorted.map((p) => statusCard(p, p.floor === floor, roster, act));
}
