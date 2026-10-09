// The report viewer (/firm?report=<id>): the Firm's audit report, section by section, with the
// downloads (Markdown, JSON) for an admin.

import type { AppStats, Report, ReviewerSection } from '../../shared/firm/report';
import { firmModelLabel, REVIEWER_BY_ID, type ReviewerId } from '../../shared/firm/roles';
import { h } from '../ui/dom';
import { usd } from './api';
import { causalChains, findingsTable, recBoard, timelineChart } from './report-parts';
import './report.css';

const VERDICT: Record<string, string> = { 'on-track': '🟢 On track', 'at-risk': '🟠 At risk', 'off-track': '🔴 Off track' };
const GAP: Record<string, string> = { exceeded: '⬆️ Exceeded', met: '✅ Met', partial: '◐ Partial', missed: '❌ Missed' };
const LVL: Record<string, number> = { low: 1, medium: 2, high: 3 };

const pct = (n?: number) => (n === undefined ? '—' : `${Math.round(n * 100)}%`);
const num = (n?: number) => (n === undefined ? '—' : n.toLocaleString());

function tiles(s: AppStats): HTMLElement {
  const t = (label: string, value: string, sub?: string, tone = '') => h('div.firm-tile', { class: tone }, h('small', {}, label), h('b', {}, value), sub ? h('span', {}, sub) : null);
  const health = s.buildHealth === 'green' ? 'good' : s.buildHealth === 'red' ? 'bad' : s.buildHealth === 'amber' ? 'warn' : '';
  return h('div.firm-tiles', {},
    t('Modules', num(s.modules), `${num(s.entities)} entities`),
    t('Pages', num(s.pages), `${num(s.microflows)} microflows`),
    t('Lines of code', num(s.loc)),
    t('Tests', num(s.tests?.count), `pass rate ${pct(s.tests?.passRate)}`, s.tests?.passRate !== undefined && s.tests.passRate < 0.8 ? 'warn' : ''),
    t('PRs merged', num(s.prsMerged), `${num(s.prsOpen)} open`),
    t('Issues', `${num(s.issuesOpen)} open`, `${num(s.issuesClosed)} closed`),
    t('Build health', s.buildHealth ?? '—', `CI pass ${pct(s.ciPassRate)}`, health),
    t('Cost to date', s.costToDate === undefined ? '—' : usd(s.costToDate), `this audit ${s.auditCost === undefined ? '—' : usd(s.auditCost)}`),
    ...(s.extra ?? []).map((e) => t(e.label, e.value)),
  );
}

const table = (head: string[], rows: (Node | string)[][], cls = '') =>
  h('div.firm-table-wrap', {}, h('table.firm-table', { class: cls }, h('thead', {}, h('tr', {}, ...head.map((x) => h('th', {}, x)))), h('tbody', {}, ...rows.map((r) => h('tr', {}, ...r.map((c) => h('td', {}, c)))))));

const section = (id: string, title: string, ...kids: (Node | null)[]) => h('section.firm-rsec', { id: `rs-${id}` }, h('h3.firm-rsec-h', {}, title), ...kids);

function reviewerSection(id: ReviewerId, s: ReviewerSection): HTMLElement {
  const role = REVIEWER_BY_ID.get(id);
  return h('details.firm-rev-sec', {},
    h('summary', {}, `${role?.icon ?? ''} ${role?.name ?? id} — ${role?.title ?? ''}`, h('small', {}, ` · ${s.findings.length} findings`)),
    h('p', {}, s.summary),
    s.artifacts.length ? h('ul', {}, ...s.artifacts.map((a) => h('li', {}, `${a.title} `, h('code', {}, a.path)))) : null,
  );
}

export function renderReport(root: HTMLElement, r: Report, admin: boolean, back: () => void) {
  const nav = [['exec', 'Summary'], ['stats', 'Statistics'], ['findings', 'Findings'], ['pros', 'Pros & cons'], ['rca', 'Root causes'], ['timeline', 'Timeline'], ['expect', 'Expectations'], ['workers', 'Agents'], ['risks', 'Risks'], ['recs', 'Recommendations'], ['appendix', 'Appendix']];
  const slackers = r.workers.filter((w) => w.slacking).length;
  root.replaceChildren(
    h('div.firm-report', {},
      h('header.firm-report-h', {},
        h('button.btn.small', { type: 'button', onclick: back }, '← The Firm'),
        h('div.firm-report-title', {}, h('small', {}, `Audit report · engagement ${r.engagement}`), h('h2', {}, r.floorName), h('p', {}, `${new Date(r.generatedAt).toLocaleString()}${r.commit ? ` · commit ${r.commit.slice(0, 10)}` : ''}${r.repo ? ` · ${r.repo}` : ''}`)),
        admin ? h('div.firm-dl', {}, h('a.btn.small', { href: `/api/firm/report?id=${encodeURIComponent(r.id)}&format=md`, download: '' }, '⬇ Markdown'), h('a.btn.small', { href: `/api/firm/report?id=${encodeURIComponent(r.id)}&format=json`, download: '' }, '⬇ JSON')) : null,
      ),
      r.sample ? h('p.firm-banner.sample', {}, '🧪 SAMPLE — seeded to show the report layout; no reviewer ran and nothing here is about a real project.') : null,
      r.partial ? h('p.firm-banner.partial', {}, '⏱️ Partial report — the engagement was cut short; this is what the reviewers had sent.') : null,
      h('nav.firm-rnav', { 'aria-label': 'Report sections' }, ...nav.map(([id, label]) => h('a', { href: `#rs-${id}` }, label))),
      section('exec', 'Executive summary',
        h('div.firm-exec', {},
          h('div.firm-verdict', { class: r.executive.verdict }, VERDICT[r.executive.verdict] ?? r.executive.verdict),
          h('h4.firm-headline', {}, r.executive.headline),
          ...r.executive.summary.split(/\n{2,}/).map((p) => h('p', {}, p)),
          r.executive.keyPoints.length ? h('ul.firm-keypoints', {}, ...r.executive.keyPoints.map((k) => h('li', {}, k))) : null,
          h('p.firm-reviewers', {}, ...r.reviewers.map((x) => h('span.firm-chip', {}, `${REVIEWER_BY_ID.get(x.id)?.icon ?? ''} ${x.name} · ${firmModelLabel(x.model)} · ${usd(x.cost)}`))),
        ),
      ),
      section('stats', 'App statistics', tiles(r.statistics)),
      section('findings', `Findings register (${r.findings.length})`, findingsTable(r.findings)),
      section('pros', 'Pros vs cons',
        h('div.firm-proscons', {},
          h('div.firm-pros', {}, h('h4', {}, '👍 Pros'), h('ul', {}, ...r.prosCons.pros.map((p) => h('li', {}, p)))),
          h('div.firm-cons', {}, h('h4', {}, '👎 Cons'), h('ul', {}, ...r.prosCons.cons.map((p) => h('li', {}, p)))),
        ),
      ),
      section('rca', 'Root cause analysis', causalChains(r.rootCauses)),
      section('timeline', 'Project timeline after review', r.timeline.summary ? h('p', {}, r.timeline.summary) : null, timelineChart(r.timeline.milestones)),
      section('expect', 'Expectations vs reality', table(['Area', 'Expected', 'Actual', 'Gap', 'Note'], r.expectations.map((e) => [h('b', {}, e.area), e.expected, e.actual, h('span.firm-gap', { class: e.gap }, GAP[e.gap] ?? e.gap), e.note ?? '']))),
      section('workers', `Agent performance${slackers ? ` · ${slackers} flagged` : ''}`,
        table(['Agent', 'Role', 'Model', 'Grade', 'Office ranking', 'Output', 'Spend', 'Slacking?', 'Evidence'], r.workers.map((w) => [
          h('b', {}, w.name), w.role ?? '', w.model ?? '', h('span.firm-grade', { class: `g-${w.grade}` }, w.grade), w.rankingGrade ?? '—', w.output, w.spend === undefined ? '—' : usd(w.spend),
          w.slacking ? h('span.firm-slack', {}, '🚩 Yes') : h('span.firm-noslack', {}, 'No'), w.evidence,
        ]), 'firm-workers'),
      ),
      section('risks', 'Risks', table(['Risk', 'Likelihood', 'Impact', 'Mitigation', 'Team'], r.risks.map((x) => [h('b', {}, x.title), x.likelihood, h('span.firm-heat', { class: `h${LVL[x.likelihood] * LVL[x.impact]}` }, x.impact), x.mitigation, x.team ?? '']))),
      section('recs', 'Recommendations', recBoard(r.recommendations)),
      section('appendix', 'Appendix: artifacts',
        r.appendix.length ? table(['Artifact', 'Kind', 'Where', 'Note'], r.appendix.map((a) => [a.title, a.kind, /^https?:/.test(a.path) ? h('a', { href: a.path, target: '_blank', rel: 'noopener' }, a.path) : h('code', {}, a.path), a.note ?? ''])) : h('p.firm-empty', {}, 'No artifacts listed.'),
        h('p.firm-note', {}, 'Paths are inside the engagement folder in the office\'s data dir (firm/engagements/<id>/<reviewer>/).'),
        ...(Object.entries(r.sections) as [ReviewerId, ReviewerSection][]).map(([id, s]) => reviewerSection(id, s)),
      ),
    ),
  );
}
