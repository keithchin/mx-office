// Putting the report together: the Partner's sections, the specialists' own, and what the office
// knows itself (PRs, issues, CI, cost, the ranking). A section the Partner never sent is filled from
// the specialists' (a partial report says so), so a cut-short engagement still delivers something.

import { spentOf, type Engagement } from '../../shared/firm/engagement.js';
import { emptyReport, mergeSections, PARTNER_SECTIONS, REQUIRED_SECTIONS, type AppStats, type Report, type ReviewerSection, type WorkerGrade } from '../../shared/firm/report.js';
import { REVIEWER_BY_ID, type ReviewerId } from '../../shared/firm/roles.js';

/** What the reviewers sent: `reviewer:<id>` for a specialist's section, the section's key for the Partner's. */
export type Sections = Record<string, unknown>;

export const missingRequired = (s: Sections) => REQUIRED_SECTIONS.filter((k) => s[k] === undefined);

export function buildReport(e: Engagement, s: Sections, office: { stats: AppStats; grades: WorkerGrade[] }, now: number): Report {
  const r = emptyReport({ id: `r-${e.id}`, engagement: e.id, floor: e.floor, floorName: e.floorName, repo: e.repo, commit: e.commit, generatedAt: now });
  r.sample = e.sample;
  r.reviewers = e.reviewers.map((x) => ({ id: x.id, name: x.name, title: REVIEWER_BY_ID.get(x.id)!.title, model: x.model, cost: Math.round(x.cost * 100) / 100 }));
  for (const [key, value] of Object.entries(s)) {
    if (key.startsWith('reviewer:')) r.sections[key.slice('reviewer:'.length) as ReviewerId] = value as ReviewerSection;
  }
  for (const key of PARTNER_SECTIONS) {
    if (s[key] !== undefined && key !== 'statistics') (r as unknown as Record<string, unknown>)[key] = s[key];
  }
  // The office's numbers first, the reviewers' measurements over them, this audit's cost last.
  const measured = Object.values(r.sections).reduce<AppStats>((acc, sec) => ({ ...acc, ...(sec?.stats ?? {}) }), {});
  r.statistics = { ...office.stats, ...measured, ...((s.statistics as AppStats | undefined) ?? {}), auditCost: Math.round(spentOf(e) * 100) / 100 };
  const missing = missingRequired(s);
  const out = mergeSections(r);
  if (!out.workers.length) out.workers = office.grades;
  if (missing.length) {
    out.partial = true;
    if (s.executive === undefined) {
      const summaries = Object.entries(out.sections).map(([id, sec]) => `**${REVIEWER_BY_ID.get(id as ReviewerId)!.title}:** ${sec?.summary ?? ''}`);
      const worst = out.findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
      out.executive = {
        verdict: worst > 2 ? 'off-track' : 'at-risk',
        headline: `Partial report: ${e.note ?? 'the Engagement Partner did not consolidate'}`,
        summary: summaries.join('\n\n') || 'No reviewer sent a section before the engagement ended.',
        keyPoints: out.findings.slice(0, 5).map((f) => `${f.severity.toUpperCase()}: ${f.title}`),
      };
    }
  }
  return out;
}
