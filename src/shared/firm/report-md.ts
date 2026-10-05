// The Firm's report as Markdown: the download on the report viewer, and the copy kept next to the
// report's JSON in the engagement folder. Pure.

import type { Report } from './report.js';
import { bySeverity } from './report.js';
import { firmModelLabel } from './roles.js';

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const table = (head: string[], rows: unknown[][]) => (rows.length ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n') : '_None._');
const usd = (n?: number) => (n === undefined ? '—' : `$${n.toFixed(2)}`);
const pct = (n?: number) => (n === undefined ? '—' : `${Math.round(n * 100)}%`);

export function reportMarkdown(r: Report): string {
  const s = r.statistics;
  const out: string[] = [];
  out.push(`# Audit report: ${r.floorName}${r.sample ? ' (SAMPLE)' : ''}`);
  out.push('');
  out.push(`The Firm · engagement ${r.engagement} · ${new Date(r.generatedAt).toISOString().slice(0, 10)}${r.commit ? ` · commit \`${r.commit.slice(0, 10)}\`` : ''}${r.repo ? ` · ${r.repo}` : ''}`);
  if (r.sample) out.push('', '> **SAMPLE** — seeded for demonstration; no reviewer ran.');
  if (r.partial) out.push('', '> **Partial report** — the engagement was cut short; this is what the reviewers had sent.');
  out.push('', `Reviewers: ${r.reviewers.map((x) => `${x.name} (${x.title}, ${firmModelLabel(x.model)}, ${usd(x.cost)})`).join('; ') || '—'}`);
  out.push('', '## Executive summary', '', `**${r.executive.verdict.toUpperCase()}** — ${r.executive.headline}`, '', r.executive.summary);
  if (r.executive.keyPoints.length) out.push('', ...r.executive.keyPoints.map((k) => `- ${k}`));
  out.push('', '## App statistics', '');
  out.push(table(['Measure', 'Value'], [
    ['Modules / entities / pages / microflows', [s.modules, s.entities, s.pages, s.microflows].map((x) => x ?? '—').join(' / ')],
    ['Lines of code', s.loc ?? '—'],
    ['Tests (pass rate)', s.tests ? `${s.tests.count} (${pct(s.tests.passRate)})` : '—'],
    ['PRs merged / open', `${s.prsMerged ?? '—'} / ${s.prsOpen ?? '—'}`],
    ['Issues open / closed', `${s.issuesOpen ?? '—'} / ${s.issuesClosed ?? '—'}`],
    ['Build health · CI pass rate', `${s.buildHealth ?? '—'} · ${pct(s.ciPassRate)}`],
    ['Cost to date · this audit', `${usd(s.costToDate)} · ${usd(s.auditCost)}`],
    ...(s.extra ?? []).map((e) => [e.label, e.value]),
  ]));
  out.push('', '## Findings', '');
  out.push(table(['ID', 'Severity', 'Team', 'Finding', 'Evidence', 'Recommendation', 'Effort'], [...r.findings].sort(bySeverity).map((f) => [f.id, f.severity, f.team, f.title, f.evidence.map((e) => [e.text, e.file && `${e.file}${e.line ? `:${e.line}` : ''}`, e.pr && `PR #${e.pr}`, e.url].filter(Boolean).join(' — ')).join('; '), f.recommendation, f.effort])));
  out.push('', '## Pros and cons', '', '**Pros**', '', ...(r.prosCons.pros.length ? r.prosCons.pros.map((p) => `- ${p}`) : ['_None._']), '', '**Cons**', '', ...(r.prosCons.cons.length ? r.prosCons.cons.map((p) => `- ${p}`) : ['_None._']));
  out.push('', '## Root cause analysis');
  for (const c of r.rootCauses) out.push('', `### ${c.problem}`, '', ...c.chain.map((w, i) => `${i + 1}. Why? ${w}`), '', `**Root cause:** ${c.rootCause}`, '', `**Fix:** ${c.fix}`);
  if (!r.rootCauses.length) out.push('', '_None._');
  out.push('', '## Project timeline after review', '');
  if (r.timeline.summary) out.push(r.timeline.summary, '');
  out.push(table(['Milestone', 'Planned', 'Forecast', 'Status', 'Confidence', 'Note'], r.timeline.milestones.map((m) => [m.name, m.planned ?? '—', m.forecast ?? '—', m.status, m.confidence, m.note ?? ''])));
  out.push('', '## Expectations vs reality', '', table(['Area', 'Expected', 'Actual', 'Gap', 'Note'], r.expectations.map((e) => [e.area, e.expected, e.actual, e.gap, e.note ?? ''])));
  out.push('', '## Worker performance', '', table(['Worker', 'Role', 'Model', 'Grade', 'Ranking', 'Output', 'Spend', 'Slacking?', 'Evidence'], r.workers.map((w) => [w.name, w.role ?? '', w.model ?? '', w.grade, w.rankingGrade ?? '—', w.output, usd(w.spend), w.slacking ? 'YES' : 'no', w.evidence])));
  out.push('', '## Risks', '', table(['Risk', 'Likelihood', 'Impact', 'Mitigation', 'Team'], r.risks.map((x) => [x.title, x.likelihood, x.impact, x.mitigation, x.team ?? ''])));
  out.push('', '## Recommendations');
  for (const p of ['now', 'next', 'later'] as const) {
    const recs = r.recommendations.filter((x) => x.priority === p);
    out.push('', `### ${p[0].toUpperCase()}${p.slice(1)}`, '', ...(recs.length ? recs.map((x) => `- **${x.title}** (${x.owner}${x.effort ? `, ${x.effort}` : ''}): ${x.detail}`) : ['_None._']));
  }
  out.push('', '## Appendix: artifacts', '', table(['Artifact', 'Kind', 'Path', 'Note'], r.appendix.map((a) => [a.title, a.kind, a.path, a.note ?? ''])));
  return `${out.join('\n')}\n`;
}
