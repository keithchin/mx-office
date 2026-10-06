// The approvals queue: everything waiting on the Project Manager (you) at the floor's autonomy level —
// escalations the team raised (the same cards as on the project console), proposals from the
// standups, the team's pull requests when merges need the Project Manager, and a cost cap reached.
// When Jeff ranked the escalations, they take their places in his order, each with its chip.

import { AUTONOMY } from '../../../shared/roster/autonomy';
import { escalationOrder } from '../../../shared/roster/escalation';
import { jeffOrder, sortedByJeff } from '../../../shared/roster/jeff-rank';
import type { ApprovalItem, RosterView } from '../../../shared/roster/types';
import { h } from '../dom';
import { escalationCard } from '../pm/escalations';
import { rankChipEl, sortedNote } from '../pm/jeff-rank';
import { proposalCard } from './proposals';
import { subagentActionCard } from './subagents';

export function approvalsView(v: RosterView, redraw: (v: RosterView) => void): HTMLElement {
  const a = AUTONOMY[v.settings.autonomy];
  // The escalations' slots, filled in Jeff's order (the server lists them loudest first).
  const byJeff = sortedByJeff(v.escalations, v.settings?.jeff?.priority);
  const order = jeffOrder(v.escalations.filter((e) => e.status === 'open'), byJeff, escalationOrder).map((e) => e.id);
  const at = (it: ApprovalItem) => (it.escalationId ? order.indexOf(it.escalationId) : -1);
  const queue = v.approvals.filter((it) => it.kind === 'escalation').sort((x, y) => at(x) - at(y));
  const ordered = v.approvals.map((it) => (it.kind === 'escalation' ? queue.shift()! : it));
  const items = ordered.flatMap((it): HTMLElement[] => {
    if (it.kind === 'proposal') {
      const p = v.proposals.find((x) => x.id === it.proposalId);
      if (p) return [proposalCard(v, p, redraw)];
    }
    if (it.kind === 'subagent') {
      const a = v.subagentActions.find((x) => x.id === it.actionId);
      if (a) return [subagentActionCard(v, a, redraw)];
    }
    if (it.kind === 'escalation') {
      const e = v.escalations.find((x) => x.id === it.escalationId);
      // Jeff's chip beside the card, not in it.
      const chip = e && byJeff ? rankChipEl(e) : null;
      if (e) return chip ? [chip, escalationCard(v.floor, e, v.admin, redraw)] : [escalationCard(v.floor, e, v.admin, redraw)];
    }
    return [h(
      'article.ro-prop',
      { class: `ro-prop-${it.kind}` },
      h('div.ro-prop-h', {}, h('span.ro-kind', {}, it.kind === 'merge' ? 'merge' : it.kind === 'escalation' ? 'escalation' : 'budget'), h('b.ro-prop-title', {}, it.title)),
      h('p.ro-prop-meta', {}, it.detail),
      it.url ? h('div.ro-actions', {}, h('a.btn.small', { href: it.url, target: '_blank', rel: 'noopener' }, '🔀 Review on GitHub')) : null,
    )];
  });
  return h(
    'section.ro-approvals',
    { 'aria-label': 'Approvals' },
    h('div.ro-bar', {}, h('div', {}, h('h3', {}, `✅ Approvals (${v.approvals.length})`), h('p.ro-sub', {}, `Level ${a.level} · ${a.name}${v.byStage ? ' · by stage' : ''}: ${a.summary} You, the Project Manager, always have the final say.`))),
    items.length ? h('div.ro-props', {}, ...(byJeff && ordered.some((it) => it.kind === 'escalation') ? [sortedNote()] : []), ...items) : h('p.ro-dim', {}, 'Nothing needs you right now.'),
  );
}
