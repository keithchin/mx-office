// The approvals queue: everything waiting on the Project Manager (you) at the floor's autonomy level —
// escalations the team raised (the same cards as on the board's project console), proposals from the
// standups, the team's pull requests when merges need the Project Manager, and a cost cap reached.

import { AUTONOMY } from '../../../shared/roster/autonomy';
import type { RosterView } from '../../../shared/roster/types';
import { h } from '../dom';
import { escalationCard } from '../pm/escalations';
import { proposalCard } from './proposals';

export function approvalsView(v: RosterView, redraw: (v: RosterView) => void): HTMLElement {
  const a = AUTONOMY[v.settings.autonomy];
  const items = v.approvals.map((it) => {
    if (it.kind === 'proposal') {
      const p = v.proposals.find((x) => x.id === it.proposalId);
      if (p) return proposalCard(v, p, redraw);
    }
    if (it.kind === 'escalation') {
      const e = v.escalations.find((x) => x.id === it.escalationId);
      if (e) return escalationCard(v.floor, e, v.admin, redraw);
    }
    return h(
      'article.ro-prop',
      { class: `ro-prop-${it.kind}` },
      h('div.ro-prop-h', {}, h('span.ro-kind', {}, it.kind === 'merge' ? 'merge' : it.kind === 'escalation' ? 'escalation' : 'budget'), h('b.ro-prop-title', {}, it.title)),
      h('p.ro-prop-meta', {}, it.detail),
      it.url ? h('div.ro-actions', {}, h('a.btn.small', { href: it.url, target: '_blank', rel: 'noopener' }, '🔀 Review on GitHub')) : null,
    );
  });
  return h(
    'section.ro-approvals',
    { 'aria-label': 'Approvals' },
    h('div.ro-bar', {}, h('div', {}, h('h3', {}, `✅ Approvals (${v.approvals.length})`), h('p.ro-sub', {}, `Level ${a.level} · ${a.name}: ${a.summary} You, the Project Manager, always have the final say.`))),
    items.length ? h('div.ro-props', {}, ...items) : h('p.ro-dim', {}, 'Nothing needs you right now.'),
  );
}
