// The selected phase under the Roadmap's timeline: its name, status and goal, four facts (rows done, journeys,
// spend, dates), the soft budget note, the exit criteria the office recorded (journeys on main, mx check, data
// impact), its journeys with their results, its rows and the merges that delivered them; Go / Stop at a
// checkpoint (part 2's checkpoint card does the same). Beside it: publishing at the phase's end (part 2) and the
// change history with the team's open proposals (Accept, Decline, Edit first).

import { dayWord } from '../../../shared/phases/timeline';
import { percentDone, rangeText, usd, type PhaseLine, type PhasesView } from '../../../shared/phases/view';
import type { PhaseChange, PhaseProposal } from '../../../shared/phases/types';
import { h } from '../dom';
import { statusBadge } from './timeline';

export interface DetailActs {
  go(phase: string): void;
  stop(phase: string): void;
  accept(p: PhaseProposal): void;
  decline(p: PhaseProposal): void;
  editFirst(p: PhaseProposal): void;
  editPhases(): void;
}

const stat = (label: string, value: string, extra?: HTMLElement | string | null, meter?: number) => h('div.rm-stat', {}, h('small', {}, label), h('b', {}, value), extra ? h('span.rm-muted.rm-stat-x', {}, extra) : null, meter !== undefined ? h('div.rm-bar2', {}, h('i', { style: `width:${meter}%` })) : null);

const chip = (ok: boolean | undefined, text: string, title?: string) => h(`span.rm-crit${ok === true ? '.pass' : ok === false ? '.fail' : ''}`, title ? { title } : {}, `${ok === true ? '✓' : ok === false ? '✕' : '○'} ${text}`);

/** The exit criteria, as the office recorded them. */
export function criteria(l: PhaseLine): HTMLElement {
  const js = l.journeys;
  const passed = js.filter((j) => j.result === 'pass').length;
  const failed = js.some((j) => j.result === 'fail');
  const mc = l.exit.modelCheck;
  return h(
    'div.rm-crits',
    {},
    chip(js.length ? (passed === js.length ? true : failed ? false : undefined) : undefined, js.length ? `journeys pass on main (${passed}/${js.length})` : 'no journeys named yet', 'Each journey passed on a running app at a commit on main (recorded by the office)'),
    chip(mc.status === 'pass' ? true : mc.status === 'fail' ? false : undefined, mc.status === 'pass' ? 'model check 0 errors' : mc.status === 'fail' ? `model check ${mc.errors ?? '?'} errors` : 'model check not run on main', mc.commit ? `mx check at ${mc.commit.slice(0, 7)}` : undefined),
    chip(l.exit.openDataImpacts === 0, l.exit.openDataImpacts ? `${l.exit.openDataImpacts} open data impact` : 'no open data impact'),
  );
}

const JWORD = { pass: '✓ pass', fail: '✕ fail', owed: 'owed' } as const;

export function phaseDetail(v: PhasesView, l: PhaseLine, acts: DetailActs): HTMLElement {
  const js = l.journeys;
  const passed = js.filter((j) => j.result === 'pass').length;
  const failing = js.filter((j) => j.result === 'fail').length;
  const overlapsWith = l.overlaps.map((o) => v.phases[o - 1]).filter(Boolean);
  const budgetNote =
    l.badge.kind === 'pace'
      ? `Soft warning only. At this pace ${l.name} lands at ${usd(l.badge.projected ?? 0)}, at or past the top of its range; the project total still pauses at ${v.budget ? usd(v.budget.total) : 'its budget'}.`
      : l.badge.kind === 'over'
        ? `Soft warning only: ${l.name} went past the top of its estimate. The project total still pauses at ${v.budget ? usd(v.budget.total) : 'its budget'}.`
        : l.badge.kind === 'upper'
          ? 'In the upper half of the estimate at the checkpoint.'
          : '';
  return h(
    'section.rm-card.rm-detail',
    { 'aria-label': `Phase ${l.order}, ${l.name}` },
    h('div.rm-dhead', {}, h('h2', {}, `Phase ${l.order} · ${l.name}`, statusBadge(l.status), l.foundation ? h('span.rm-badge.b-found', {}, 'Foundation') : null, overlapsWith.length && l.early ? h('span.rm-badge.b-overlap', {}, `Overlaps with ${overlapsWith.map((o) => `${o.order} · ${o.name}`).join(', ')}`) : null), l.goal ? h('p', {}, l.goal) : null),
    l.early ? h('div.rm-banner.rm-early', {}, `${l.early.what[0].toUpperCase()}${l.early.what.slice(1)} for ${l.name} started on ${dayWord(l.early.since)} while the phase before it is built; its build starts when that phase is done. Recorded as a change.`) : null,
    h(
      'div.rm-stats',
      {},
      stat('Rows done', `${l.rowsDone}/${l.rows.length}`, null, percentDone(l)),
      stat('Journeys', `${passed}/${js.length}`, failing ? `${failing} failing` : js.length && !passed ? 'not run yet' : null),
      stat('Spend', usd(l.spend), `of ${rangeText(l.estimate)}`),
      stat(l.span.actual ? 'Dates' : 'Dates (forecast)', `${dayWord(l.span.start)} – ${dayWord(l.span.end)}`),
    ),
    budgetNote ? h('p.rm-note', {}, h(`span.rm-badge.sm.b-${l.badge.kind === 'over' ? 'bad' : 'warn'}`, {}, l.badge.text), ` ${budgetNote}`) : null,
    h('h3.rm-sec', {}, 'Exit criteria ', h('span.rm-plain', {}, 'recorded by the office')),
    criteria(l),
    l.status === 'checkpoint' && v.admin
      ? h('div.rm-cpacts', {}, h('span', {}, `${l.name} passed its exit criteria. `), h('button.btn.primary', { type: 'button', onclick: () => acts.go(l.id) }, 'Go: start the next phase'), h('button.btn', { type: 'button', onclick: () => acts.stop(l.id) }, 'Stop'))
      : null,
    h('h3.rm-sec', {}, 'Journeys'),
    js.length
      ? h('ul.rm-jlist', {}, ...js.map((j) => h('li', {}, h(`span.rm-j.${j.result}`, {}, JWORD[j.result]), h('code', {}, j.id), h('span', {}, j.title ?? ''))))
      : h('p.rm-muted', {}, 'No journeys prove this phase yet: the team names them in its proposal.'),
    h('h3.rm-sec', {}, `Rows (${l.rows.length})`),
    h('ul.rm-rows', {}, ...l.rows.map((r) => h('li', { class: r.done ? 'done' : '' }, h('code', {}, `Row ${r.n}`), h('span', {}, r.step || '(not in the build plan at main)'), r.done ? h('span.rm-muted', {}, '✓ done') : null))),
    h('h3.rm-sec', {}, 'Merges'),
    l.merges.length
      ? h('ul.rm-merges', {}, ...l.merges.map((m) => h('li', {}, h('code.rm-pr', {}, m.pr ? `#${m.pr}` : m.sha.slice(0, 7)), h('span', {}, m.title), h('time', {}, m.at ? dayWord(m.at) : ''))))
      : h('p.rm-muted', {}, 'Nothing merged on main for these rows yet.'),
  );
}

/** Publishing at the end of the phase: what part 2 does, said plainly. */
export function publishCard(l: PhaseLine): HTMLElement {
  return h(
    'section.rm-card',
    { 'aria-label': 'Sandbox and report' },
    h('h3.rm-ct', {}, 'Sandbox and report'),
    l.publish
      ? h('div.rm-pub', {}, h('b', {}, 'Publishes at phase end'), h('p.rm-muted', {}, l.checkpoint ? 'After your checkpoint. On a Free App the office prepares the commit and the model check and you publish with one click in Studio Pro; on a licensed node it deploys through the pipeline.' : 'With the checkpoint off, a Free App still needs your one click in Studio Pro: it shows in Needs you.'))
      : h('p.rm-muted', {}, 'Not published at the end of this phase.'),
    h('p.rm-muted.rm-small', {}, 'The phase-end report is written from the recorded results when the phase ends.'),
  );
}

const whoLine = (c: PhaseChange) => `${c.id} · ${c.proposedBy.kind === 'pm' ? `${c.proposedBy.name} (PM edit)` : `proposed by ${c.proposedBy.name}${c.decidedBy ? ` · ${c.decision ?? 'accepted'} by ${c.decidedBy.name}` : ''}`}`;

export function changesCard(v: PhasesView, acts: DetailActs): HTMLElement {
  const open = v.proposals.filter((p) => p.status === 'open' && p.kind === 'change');
  return h(
    'section.rm-card',
    { 'aria-label': 'Changes to phases' },
    h('div.rm-ct-row', {}, h('h3.rm-ct', {}, 'Changes to phases'), v.admin && v.plan.state !== 'none' ? h('button.pt-link.rm-link', { type: 'button', onclick: () => acts.editPhases() }, 'Edit phases') : null),
    ...open.map((p) =>
      h(
        'div.rm-proposal',
        { 'data-proposal': p.id },
        h('div.rm-prop-h', {}, h('b', {}, `${p.by.name} proposes a change`), p.by.role ? h('span.rm-muted', {}, ` · ${p.by.role}`) : null, h('span.rm-grow'), h('span.rm-needs', {}, 'Needs you')),
        h('p', {}, p.summary),
        h('p.rm-muted', {}, p.reason),
        v.admin ? h('div.rm-prop-acts', {}, h('button.btn.primary.sm', { type: 'button', onclick: () => acts.accept(p) }, 'Accept'), h('button.btn.sm', { type: 'button', onclick: () => acts.decline(p) }, 'Decline'), h('button.pt-link.rm-link', { type: 'button', onclick: () => acts.editFirst(p) }, 'Edit first')) : null,
      ),
    ),
    v.changes.length
      ? h('ul.rm-chg', {}, ...v.changes.map((c) => h('li', {}, h('time', {}, dayWord(c.at)), h('div', {}, h('div', {}, c.summary), h('div.rm-who', {}, whoLine(c)), c.reason ? h('div.rm-who', { title: 'Reason' }, `“${c.reason}”`) : null))))
      : h('p.rm-muted', {}, 'No changes yet.'),
    ...v.proposals.filter((p) => p.status === 'declined').slice(0, 3).map((p) => h('p.rm-muted.rm-small', {}, `${p.id} declined: ${p.summary}${p.note ? ` (${p.note})` : ''}`)),
  );
}
