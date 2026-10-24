// "Before you accept": what will refuse ✅ Accept and what's only informational (shared/acceptance-gates.ts,
// worked out by the server with Accept's own checks: GET /api/acceptance/draft's gates). Shown in the acceptance
// record window and at the top of the Accept dialog, so the refusal is never a surprise after pressing.

import { blockers, gatesHeadline, type AcceptGate } from '../../../shared/acceptance-gates';
import { h } from '../dom';

const MARK: Record<AcceptGate['state'], string> = { pass: '✅', fail: '⛔', unknown: '❔', info: 'ℹ️' };

/** The gates as a section: the enforced ones first (each pass or what refuses it), then the informational ones. `open` follows an action. */
export function gatesSection(gates: readonly AcceptGate[], open?: (tab: string) => void): HTMLElement {
  const row = (g: AcceptGate) =>
    h(
      'li',
      { class: `acc-gate acc-gate-${g.state}`, 'data-gate': g.id },
      h('span.acc-st', { 'aria-hidden': 'true' }, MARK[g.state]),
      h('span.acc-l', {}, g.label),
      h('small', {}, g.text, g.action && open && g.state !== 'pass' ? h('span', {}, ' ', h('button.acc-gate-go', { type: 'button', onclick: () => open(g.action!.tab) }, g.action.label)) : ''),
    );
  const enforced = gates.filter((g) => g.enforced);
  const info = gates.filter((g) => !g.enforced);
  const b = blockers(gates).length;
  return h(
    'section.acc-sec.acc-gates',
    { 'aria-label': 'Before you accept' },
    h('h3', {}, 'Before you accept'),
    h('p', { class: b ? 'acc-problem' : 'acc-dim', role: 'status' }, gatesHeadline(gates)),
    h('p.acc-dim', {}, 'Enforced by the office (Accept is refused while one fails):'),
    h('ul.acc-lines', {}, ...enforced.map(row)),
    info.length ? h('p.acc-dim', {}, 'Informational (recorded with the acceptance, never a refusal):') : null,
    info.length ? h('ul.acc-lines', {}, ...info.map(row)) : null,
  );
}
