// The check before something you start reaches agents in the middle of a turn (shared/roster/interrupt.ts):
// a standup, or a team question from the project console ("What's blocking?", "Plan next steps"). It lists
// who is ready and who is working, on what and for how long, and for each busy one asks: interrupt now,
// after their current turn (the default: the office holds it and types it when that turn ends), or for a
// standup, skip them and read their journal. "Same for all" sets every row at once. Nobody busy: no window,
// it just goes. ✕ and Esc cancel. No three.js here: the 1D view imports it.

import type { RoleId } from '../../../shared/roster/roles';
import type { RosterView } from '../../../shared/roster/types';
import { standupRoles } from '../../../shared/roster/coverage';
import { CHOICE_LABEL, choicesFor, isBusyRow, resolveChoices, teamRows, workingFor, type CheckKind, type InterruptChoice, type TeamRow } from '../../../shared/roster/interrupt';
import { store } from '../../state';
import { h, openModal } from '../dom';
import { coverageOf } from './coverage';
import './interrupt-check.css';

export type Choices = Partial<Record<RoleId, InterruptChoice>>;

export interface CheckOptions {
  kind: CheckKind;
  title: string;
  /** What is about to go, in a few words ("a standup", "“What's blocking?” to Niklaus, who asks the Leads"). */
  what: string;
  rows: TeamRow[];
  ok: string;
}

const STATE_TEXT: Record<TeamRow['state'], string> = { ready: '✅ Ready', working: '⏳ Working', asking: '🙋 Asking you', away: '💤 Away' };

/** The choices for each busy member, or undefined when you cancelled. Nobody busy: {} straight away, no window. */
export function interruptCheck(o: CheckOptions): Promise<Choices | undefined> {
  const busy = o.rows.filter(isBusyRow);
  if (!busy.length) return Promise.resolve({});
  return new Promise((resolve) => {
    const now = Date.now();
    const picked: Choices = {};
    let same: InterruptChoice | undefined;
    const allowed = choicesFor(o.kind);
    const groups: { role?: RoleId; buttons: HTMLButtonElement[] }[] = [];
    const paint = () => {
      for (const g of groups) {
        const value = g.role ? (same ?? picked[g.role] ?? 'after') : same;
        for (const b of g.buttons) {
          const on = b.dataset.v === value;
          b.setAttribute('aria-checked', String(on));
          b.classList.toggle('on', on);
          b.tabIndex = on || (!value && b === g.buttons[0]) ? 0 : -1;
        }
      }
    };
    /** A row of choice buttons (a radio group); `role` undefined is "same for all". */
    const group = (label: string, role?: RoleId) => {
      const buttons = allowed.map((c) =>
        h('button.btn.small.ic-opt', { type: 'button', role: 'radio', 'data-v': c, onclick: () => (role ? ((picked[role] = c), (same = undefined)) : (same = c), paint()) }, CHOICE_LABEL[c]),
      );
      groups.push({ role, buttons });
      return h('div.ic-opts', { role: 'radiogroup', 'aria-label': label }, ...buttons);
    };
    const row = (r: TeamRow) =>
      h(
        'li.ic-row',
        { class: `ic-${r.state}` },
        h('span.ic-who', {}, h('span', { 'aria-hidden': 'true' }, `${r.icon} `), h('b', {}, r.name)),
        h('span.ic-state', {}, STATE_TEXT[r.state], r.state === 'working' && r.since !== undefined ? ` · ${workingFor(r.since, now).replace(/^working,?\s*/, '')}` : '', r.what ? h('span.ic-what', {}, ` on ${r.what}`) : ''),
        isBusyRow(r) ? group(`What to do about ${r.name}`, r.role) : '',
      );
    let answered = false;
    const finish = (v: Choices | undefined) => {
      if (answered) return;
      answered = true;
      modal.close();
      resolve(v);
    };
    const content = h(
      'div.modal.ic',
      { role: 'dialog', 'aria-label': o.title },
      h('header', {}, h('h2', { title: o.title }, o.title)),
      h(
        'div.body',
        {},
        h('p.ic-lead', {}, `Before sending ${o.what}: ${busy.length === 1 ? `${busy[0].name} is` : `${busy.length} of them are`} in the middle of something.`),
        busy.length > 1 ? h('div.ic-same', {}, h('span.ic-same-l', {}, 'Same for all:'), group('Same for everyone busy')) : '',
        h('ul.ic-list', {}, ...o.rows.map(row)),
        h('p.ic-note', {}, o.kind === 'standup' ? '“After their current turn” asks them once they stop; the standup waits up to 20 minutes for them.' : '“After their current turn” holds the message (and the Coordinator’s relay of it) until they stop.'),
      ),
      h('footer', {}, h('button.btn', { type: 'button', onclick: () => finish(undefined) }, 'Cancel'), h('button.btn.primary.ic-ok', { type: 'button', onclick: () => finish(resolveChoices(o.rows, picked, same)) }, o.ok)),
    );
    // Arrow keys move within a radio group, as the console's Chat | Terminal toggle does.
    content.addEventListener('keydown', (e) => {
      const b = e.target as HTMLElement;
      if (!b.classList?.contains('ic-opt') || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      const g = groups.find((x) => x.buttons.includes(b as HTMLButtonElement));
      if (!g) return;
      e.preventDefault();
      const i = (g.buttons.indexOf(b as HTMLButtonElement) + (e.key === 'ArrowRight' ? 1 : g.buttons.length - 1)) % g.buttons.length;
      g.buttons[i].click();
      g.buttons[i].focus();
    });
    const modal = openModal(content, { onClose: () => finish(undefined) });
    paint();
    setTimeout(() => content.querySelector<HTMLButtonElement>('.ic-ok')?.focus(), 0);
  });
}

const workerOf = (id: string) => store.workers.get(id);

/** The check before a standup: the Leads it would ask. */
export function checkStandup(v: RosterView): Promise<Choices | undefined> {
  return interruptCheck({ kind: 'standup', title: '📋 Run standup', what: 'the standup', rows: teamRows(v.members, workerOf, standupRoles(coverageOf(v))), ok: '▶️ Run standup' });
}

/** The check before a team question to the Coordinator: it and every Lead it may ask, hired and not benched. */
export function checkTeamAsk(v: RosterView, label: string, coordinator: string): Promise<Choices | undefined> {
  const rows = teamRows(v.members.filter((m) => m.status !== 'not-hired' && m.status !== 'benched'), workerOf);
  return interruptCheck({ kind: 'ask', title: label, what: `“${label.replace(/^\W+\s*/, '')}” to ${coordinator}, who may ask the Leads`, rows, ok: 'Send' });
}
