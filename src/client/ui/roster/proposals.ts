// A Lead's proposal as a card for the Project Manager: what it is, who proposed it at which standup, and
// Approve (it becomes a GitHub issue labelled with the team), Reject (with the reason) or Change
// (what to change). Decided ones say what was decided, by whom, and link the issue.

import { DECISION_LABEL } from '../../../shared/roster/autonomy';
import type { Proposal, RosterView } from '../../../shared/roster/types';
import { h, timeAgo } from '../dom';
import { act } from './api';
import { askText } from './ask';

const STATE: Record<Proposal['status'], string> = {
  pending: '⏳ Awaiting you',
  approved: '✅ Approved',
  auto: "✅ Within the team's autonomy",
  rejected: '❌ Rejected',
  change: '✏️ Change requested',
};

export function proposalCard(v: RosterView, p: Proposal, redraw: (v: RosterView) => void): HTMLElement {
  const decide = (decision: string, reason?: string) => void act(v.floor, 'decide', { proposal: p.id, decision, reason }).then((r) => r && redraw(r));
  const open = p.status === 'pending' || p.status === 'change';
  const issue = p.issue?.url ? h('a', { href: p.issue.url, target: '_blank', rel: 'noopener' }, `#${p.issue.number ?? ''} on GitHub`) : p.issue?.dryRun ? 'dry run: no issue made' : null;
  return h(
    'article.ro-prop',
    { class: `ro-prop-${p.status}`, 'data-proposal': p.id },
    h('div.ro-prop-h', {}, h('span.ro-kind', {}, p.kind), h('b.ro-prop-title', {}, p.title), h('span.ro-prop-state', {}, STATE[p.status])),
    p.detail ? h('p.ro-prop-detail', {}, p.detail) : null,
    h('p.ro-prop-meta', {}, `${p.by} · ${p.team} team · standup ${p.standup} · ${DECISION_LABEL[p.kind]}`),
    p.decidedBy ? h('p.ro-prop-meta', {}, `${p.status === 'approved' ? 'Approved' : p.status === 'rejected' ? 'Rejected' : 'Change asked'} by ${p.decidedBy}${p.decidedAt ? ` ${timeAgo(p.decidedAt)}` : ''}${p.reason ? `: ${p.reason}` : ''}`, issue ? ' · ' : '', issue) : issue ? h('p.ro-prop-meta', {}, issue) : null,
    open && v.admin
      ? h(
          'div.ro-actions',
          {},
          h('button.btn.small.ro-approve', { type: 'button', onclick: () => decide('approve') }, '✅ Approve'),
          h('button.btn.small.ro-reject', { type: 'button', onclick: () => askText({ title: `Reject “${p.title}”`, label: `Why? ${p.by} and the PM are told`, long: true, ok: '❌ Reject' }, (r) => decide('reject', r)) }, '❌ Reject'),
          h('button.btn.small', { type: 'button', onclick: () => askText({ title: `Change “${p.title}”`, label: 'What should change? The Lead can propose it again', long: true, ok: '✏️ Ask for a change' }, (r) => decide('change', r)) }, '✏️ Change'),
        )
      : null,
  );
}
