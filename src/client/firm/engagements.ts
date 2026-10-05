// The engagements on /firm: the ones under way, live (each reviewer's status and spend, questions
// asked and answered, the budget bar, the latest of the transcript), and the past ones with their
// reports.

import { isActive, PHASE_LABEL, REVIEWER_STATUS_LABEL, spentOf, type Engagement } from '../../shared/firm/engagement';
import { firmModelLabel, REVIEWER_BY_ID } from '../../shared/firm/roles';
import { h, timeAgo, toast } from '../ui/dom';
import { firmAction, reportUrl, usd, type FirmView } from './api';

/** The spend-vs-budget bar: amber past 80%, red at the cap. */
export function budgetBar(spent: number, budget: number, estimate?: number): HTMLElement {
  const pct = Math.min(100, (spent / Math.max(budget, 0.01)) * 100);
  const level = pct >= 100 ? 'cap' : pct >= 80 ? 'warn' : 'ok';
  return h('div.firm-budget', { class: level, role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': budget, 'aria-valuenow': Math.round(spent * 100) / 100, 'aria-label': 'Spend against budget' },
    h('div.firm-budget-fill', { style: `width:${pct.toFixed(1)}%` }),
    estimate ? h('div.firm-budget-est', { style: `left:${Math.min(100, (estimate / budget) * 100).toFixed(1)}%`, title: `Estimate ${usd(estimate)}` }) : null,
    h('span.firm-budget-text', {}, `${usd(spent)} of ${usd(budget)}${level === 'warn' ? ' · 80% warning' : level === 'cap' ? ' · at the cap' : ''}`),
  );
}

function activeCard(e: Engagement, admin: boolean, reload: () => void): HTMLElement {
  const answered = e.questions.filter((q) => q.status === 'answered').length;
  const open = e.questions.filter((q) => q.status === 'open').length;
  const cancel = async () => {
    if (!confirm(`Cancel the audit of ${e.floorName}? The reviewers stop and no report is delivered.`)) return;
    try {
      await firmAction({ action: 'cancel', id: e.id });
      toast('Audit cancelled');
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return h(
    'article.firm-eng.active',
    {},
    h('header.firm-eng-h', {},
      h('div', {}, h('h3', {}, `📑 ${e.floorName}`), h('p.firm-eng-meta', {}, `${PHASE_LABEL[e.phase]} · ${e.config.depth} · called by ${e.requestedBy} ${timeAgo(e.requestedAt)}${e.commit ? ` · @${e.commit.slice(0, 8)}` : ''}${e.sample ? ' · SAMPLE' : ''}`)),
      admin ? h('button.btn.small.danger', { type: 'button', onclick: cancel }, 'Cancel') : null,
    ),
    budgetBar(spentOf(e), e.config.budget, e.estimate),
    h('p.firm-eng-q', {}, `❓ ${e.questions.length} question${e.questions.length === 1 ? '' : 's'} asked · ${answered} answered · ${open} open`),
    h('ul.firm-runs', {}, ...e.reviewers.map((r) => {
      const role = REVIEWER_BY_ID.get(r.id)!;
      return h('li.firm-run', { class: r.status },
        h('span.firm-run-who', {}, `${role.icon} ${r.name}`, h('small', {}, role.title)),
        h('span.pill.firm-run-st', { class: r.status }, REVIEWER_STATUS_LABEL[r.status]),
        h('span.firm-run-model', {}, firmModelLabel(r.model)),
        h('span.firm-run-cost', {}, usd(r.cost)),
        r.activity ? h('span.firm-run-act', {}, r.activity) : null,
      );
    })),
    e.transcript.length
      ? h('details.firm-transcript', {}, h('summary', {}, 'Transcript'), h('ol', {}, ...e.transcript.slice(-25).map((t) => h('li', {}, h('b', {}, t.who), ` ${t.text}`, h('small', {}, ` · ${timeAgo(t.at)}`)))))
      : null,
  );
}

function pastRow(e: Engagement): HTMLElement {
  return h('li.firm-past', { class: e.phase },
    h('span.firm-past-name', {}, h('b', {}, e.floorName), h('small', {}, `${PHASE_LABEL[e.phase]} · ${new Date(e.requestedAt).toLocaleDateString()} · ${e.reviewers.length} reviewers · ${usd(spentOf(e))}${e.sample ? ' · SAMPLE' : ''}`)),
    e.reportId ? h('a.btn.small.firm-brass', { href: reportUrl(e.reportId) }, '📑 Read report') : h('span.firm-past-none', {}, e.note ?? 'No report'),
  );
}

export function renderEngagements(active: HTMLElement, past: HTMLElement, view: FirmView, reload: () => void) {
  const live = view.engagements.filter((e) => isActive(e.phase));
  const done = view.engagements.filter((e) => !isActive(e.phase));
  active.replaceChildren(
    h('h2.lite-h.firm-h', {}, 'Engagements under way'),
    live.length ? h('div.firm-engs', {}, ...live.map((e) => activeCard(e, view.admin, reload))) : h('p.firm-empty', {}, 'Every reviewer is in the office. Call an audit to send a team to a project.'),
  );
  past.replaceChildren(h('h2.lite-h.firm-h', {}, 'Past engagements & reports'), done.length ? h('ul.firm-pasts', {}, ...done.map(pastRow)) : h('p.firm-empty', {}, 'No audits yet.'));
}
