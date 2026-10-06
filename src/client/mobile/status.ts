// The phone version's Status tab: a compact card per project (GET /api/m/status): who's working, asking
// or asleep, the toolkit gate or stage it's at, open escalations, the team's spend against its cap (the
// Budget feature's chip goes in that slot), a ⏸ pause and the progress of a resume or pause, and its
// buttons: go there, Raise cap, Hire, ⏸ Pause / ▶ Resume. A 🔁 safe restart shows on top, read-only.

import { restartWords, runWords, statusWords, type ProjectStatus, type RestartLine } from '../../shared/mobile';
import { pauseLine } from '../../shared/project-run';
import type { RosterView } from '../../shared/roster/types';
import { h } from '../ui/dom';

export interface StatusActions {
  go(floor: string): void;
  raiseCap(p: ProjectStatus): void;
  hire(p: ProjectStatus): void;
  pause(p: ProjectStatus): void;
  resume(p: ProjectStatus): void;
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
    ),
    p.pause ? h('p.m-paused', {}, pauseLine(p.pause, (at) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))) : null,
    p.run ? h('p.m-run', { role: 'status', class: p.run.finishedAt ? '' : 'm-run-going' }, runWords(p.run)) : null,
    p.stage ? h('p.m-stage', {}, `🧭 ${p.stage}`) : null,
    p.paused ? h('p.m-warn', {}, `💸 ${p.paused}`) : null,
    h(
      'div.m-acts',
      {},
      p.paused || p.spend?.cap ? h('button.btn.small', { type: 'button', onclick: () => act.raiseCap(p) }, '💸 Raise cap') : null,
      canHire ? h('button.btn.small', { type: 'button', onclick: () => act.hire(p) }, '➕ Hire') : null,
      running(p) ? null : p.pause ? h('button.btn.small.primary', { type: 'button', onclick: () => act.resume(p) }, '▶ Resume…') : h('button.btn.small', { type: 'button', onclick: () => act.pause(p) }, '⏸ Pause'),
    ),
  );
}

/** A resume or pause still going: no second one until it's done. */
export const running = (p: Pick<ProjectStatus, 'run'>) => !!p.run && !p.run.finishedAt && (p.run.status === 'running' || p.run.status === 'waiting');

export function statusList(list: readonly ProjectStatus[] | undefined, floor: string | undefined, roster: RosterView | undefined, act: StatusActions, error?: string, restart?: RestartLine): HTMLElement[] {
  if (error) return [h('p.m-empty', {}, `Couldn’t load the status: ${error}`)];
  const top = restart ? [h('p.m-restart', { role: 'status' }, restartWords(restart), h('small.m-dim', {}, ' · decided on a computer'))] : [];
  if (!list) return [h('p.m-empty', {}, 'Loading…')];
  if (!list.length) return [h('p.m-empty', {}, 'No projects yet. Add one from the home page on a computer.')];
  const sorted = [...list].sort((a, b) => (a.floor === floor ? -1 : b.floor === floor ? 1 : b.asking + b.escalations - (a.asking + a.escalations)));
  return [...top, ...sorted.map((p) => statusCard(p, p.floor === floor, roster, act))];
}
