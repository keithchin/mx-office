// The specialist rankings: what each team role (shared/roster/roles.ts) is graded on for its own job,
// on top of the standard four. A table per role, each criterion a function of the facts that returns
// a score with its evidence, or nothing when the office has no data for it (shown as "not enough
// data", left out of the average). A new criterion is a new row; a role with no row has no specialist ranking.

import type { RunRecord } from '../analysis.js';
import type { Escalation } from '../roster/escalation.js';
import { ROLE_BY_ID, type RoleId } from '../roster/roles.js';
import { clamp100, combine, confidenceOf, gradeOf, mean, median, plural, round1, type Confidence, type Criterion, type WorkerFacts } from './model.js';

/** What a criterion measured: 0–100, the lines behind it, and how many samples it rests on. */
export interface Measure {
  score: number;
  evidence: string[];
  n: number;
}

export interface SpecialistDef {
  key: string;
  label: string;
  weight: number;
  /** Undefined when there's nothing to go on; a string says why (for something the office doesn't record yet). */
  measure: (f: WorkerFacts) => Measure | string | undefined;
}

export interface Specialist {
  label: string;
  score?: number;
  grade?: ReturnType<typeof gradeOf>;
  criteria: Criterion[];
}

/** How much the specialist ranking counts in a team role's overall score; the standard four make up the rest. */
export const SPECIALIST_SHARE = 0.3;

const DAY = 86_400_000;
const activeDays = (f: WorkerFacts) => {
  const days = new Set(f.runs.flatMap((r) => [Math.floor(r.startedAt / DAY), Math.floor(r.endedAt / DAY)]));
  return Math.max(1, days.size);
};

/** Of its resolved escalations, the share the Project Manager didn't dismiss as unneeded. */
function escalationPrecision(f: WorkerFacts): Measure | undefined {
  const resolved = f.escalations.filter((e) => e.status === 'resolved' && e.resolution);
  if (!resolved.length) return undefined;
  const dismissed = resolved.filter((e) => e.resolution!.verdict === 'dismiss' && !e.fyi).length;
  const fyi = resolved.filter((e) => e.fyi).length;
  return {
    score: ((resolved.length - dismissed) / resolved.length) * 100,
    evidence: [`${plural(resolved.length, 'escalation')} answered: ${dismissed} dismissed as unneeded${fyi ? `, ${fyi} raised as FYI below the floor's threshold` : ''}`],
    n: resolved.length,
  };
}

/** Its team journal: entries on the days it worked, lessons written down, handoffs. */
function journalQuality(f: WorkerFacts): Measure | undefined {
  const j = f.team?.journal;
  if (!j || !j.entries) return undefined;
  const days = activeDays(f);
  const cover = Math.min(1, j.days / days);
  return {
    score: 60 * cover + 25 * (j.lessons > 0 ? 1 : 0) + 15 * (j.handoffs > 0 || !f.gone ? 1 : 0),
    evidence: [`${plural(j.entries, 'journal entry', 'journal entries')} on ${plural(j.days, 'day')} (worked on ${plural(days, 'day')})`, `${plural(j.lessons, 'entry', 'entries')} with lessons learned${j.handoffs ? `, ${plural(j.handoffs, 'handoff note')}` : ''}`],
    n: j.entries,
  };
}

/** Its team's labelled pull requests: merged against closed unmerged. */
function teamThroughput(f: WorkerFacts): Measure | undefined {
  const p = f.team?.teamPrs;
  if (!p || !(p.merged + p.closed)) return undefined;
  return { score: (p.merged / (p.merged + p.closed)) * 100, evidence: [`Team PRs: ${p.merged} merged, ${p.closed} closed unmerged, ${p.open} open`], n: p.merged + p.closed };
}

/** The floor's runs of a kind (ui-pages, tests…): how many merged. */
function floorKind(f: WorkerFacts, kind: RunRecord['types'][number], what: string): Measure | undefined {
  const runs = (f.team?.floorRuns ?? []).filter((r) => r.types.includes(kind) && r.outcome !== 'running' && !r.excluded);
  if (!runs.length) return undefined;
  const merged = runs.filter((r) => r.outcome === 'merged').length;
  return { score: (merged / runs.length) * 100, evidence: [`${merged} of ${plural(runs.length, what)} on the floor merged`], n: runs.length };
}

const NOT_TRACKED = (what: string) => `The office doesn't record ${what} yet`;

/** How soon its subagents' finished runs were reviewed (office-workers subagent review): the median, within 15 min is best. */
function reviewTurnaround(f: WorkerFacts): Measure | undefined {
  const t = f.team?.reviews?.turnaroundMin ?? [];
  if (!t.length) return undefined;
  const m = median(t) ?? 0;
  return { score: promptness(m, 15), evidence: [`Median ${Math.round(m)} min from a subagent finishing to its review, over ${plural(t.length, 'review')}`], n: t.length };
}

/** Every finished subagent run reviewed, and rework sent back before it reached a PR. */
function reviewQuality(f: WorkerFacts): Measure | undefined {
  const r = f.team?.reviews;
  const reviewed = r ? r.accepted + r.reworked : 0;
  if (!r || !(reviewed + r.unreviewed)) return undefined;
  const coverage = reviewed / (reviewed + r.unreviewed);
  return {
    score: coverage * 100,
    evidence: [`Reviewed ${reviewed} of ${plural(reviewed + r.unreviewed, 'finished subagent run')}`, `${plural(r.reworked, 'rework', 'reworks')} caught in review${r.failed ? `, ${plural(r.failed, 'failed run')}` : ''}`],
    n: reviewed + r.unreviewed,
  };
}

/** Every Lead's common criteria, then its role's own. */
const LEAD_COMMON: SpecialistDef[] = [
  { key: 'review-turnaround', label: 'Review turnaround', weight: 0.15, measure: (f) => reviewTurnaround(f) ?? NOT_TRACKED('a review of its subagents’ work') },
  { key: 'review-quality', label: 'Review quality', weight: 0.15, measure: (f) => reviewQuality(f) ?? NOT_TRACKED('a review of its subagents’ work') },
  { key: 'escalation-precision', label: 'Escalation precision', weight: 0.2, measure: escalationPrecision },
  { key: 'throughput', label: 'Team throughput', weight: 0.2, measure: teamThroughput },
  { key: 'journal', label: 'Journal & handoffs', weight: 0.15, measure: journalQuality },
];

function leadSpec(flavour: SpecialistDef): SpecialistDef[] {
  return [...LEAD_COMMON, flavour];
}

/** Minutes between two times as a score: within `good` minutes is 100, falling to 40 by a day. */
function promptness(minutes: number, good: number): number {
  if (minutes <= good) return 100;
  if (minutes <= 60) return 85;
  if (minutes <= 240) return 70;
  if (minutes <= 1440) return 55;
  return 40;
}

/** An escalation's summary: details to go on, options to pick from, a recommendation. */
const summaryScore = (e: Escalation) => (e.details.length >= 80 ? 0.4 : e.details.length >= 20 ? 0.2 : 0) + (e.options.length >= 2 ? 0.3 : 0) + (e.recommendation ? 0.3 : 0);

export const SPECIALIST: Record<RoleId, SpecialistDef[]> = {
  pm: [
    {
      key: 'plan',
      label: 'Plan upkeep',
      weight: 0.2,
      measure: (f) => {
        const j = f.team?.journal;
        if (!j?.entries) return undefined;
        const days = activeDays(f);
        return { score: Math.min(1, j.days / days) * 100, evidence: [`Management journal updated on ${plural(j.days, 'day')} of ${days} worked`], n: j.entries };
      },
    },
    {
      key: 'standups',
      label: 'Standups on time',
      weight: 0.25,
      measure: (f) => {
        const s = f.team?.standups ?? [];
        if (!s.length) return undefined;
        const each = s.map((x) => (x.compiledAt ? promptness((x.compiledAt - x.startedAt) / 60_000, 30) : 0));
        const compiled = s.filter((x) => x.compiledAt);
        const mid = median(compiled.map((x) => (x.compiledAt! - x.startedAt) / 60_000));
        return { score: mean(each), evidence: [`${compiled.length} of ${plural(s.length, 'standup')} compiled${mid !== undefined ? `, median ${Math.round(mid)} min after starting` : ''}`], n: s.length };
      },
    },
    {
      key: 'relay',
      label: 'Escalation summaries',
      weight: 0.2,
      measure: (f) => {
        if (!f.escalations.length) return undefined;
        const s = mean(f.escalations.map(summaryScore));
        const rec = f.escalations.filter((e) => e.recommendation).length;
        return { score: s * 100, evidence: [`${plural(f.escalations.length, 'escalation')} relayed, ${rec} with a recommendation`], n: f.escalations.length };
      },
    },
    {
      key: 'unblock',
      label: 'Leads unblocked',
      weight: 0.2,
      measure: (f) => {
        const done = (f.team?.leadEscalations ?? []).filter((e) => e.resolution);
        if (!done.length) return undefined;
        const mid = median(done.map((e) => (e.resolution!.at - e.at) / 60_000))!;
        return { score: promptness(mid, 15), evidence: [`Leads' escalations answered in a median ${Math.round(mid)} min (${plural(done.length, 'escalation')})`], n: done.length };
      },
    },
    {
      key: 'batching',
      label: 'Questions batched',
      weight: 0.15,
      measure: (f) => {
        if (!f.escalations.length) return undefined;
        const per = f.escalations.length / activeDays(f);
        return { score: per <= 2 ? 100 : per <= 4 ? 80 : per <= 7 ? 60 : 40, evidence: [`${round1(per)} questions to the Project Manager per working day`], n: f.escalations.length };
      },
    },
  ],
  'lead-designer': leadSpec({ key: 'design', label: 'Design reviews', weight: 0.15, measure: (f) => floorKind(f, 'ui-pages', 'UI / page task') }),
  'lead-developer': leadSpec({
    key: 'build',
    label: 'Build health',
    weight: 0.15,
    measure: (f) => {
      const p = f.team?.teamPrs;
      const mx = (f.team?.floorRuns ?? []).filter((r) => typeof r.scorecard?.mxErrors === 'number');
      const parts: [number, string][] = [];
      if (p && p.checksPass + p.checksFail) parts.push([p.checksPass / (p.checksPass + p.checksFail), `CI green on ${p.checksPass} of ${p.checksPass + p.checksFail} team PRs`]);
      if (mx.length) parts.push([mx.filter((r) => r.scorecard!.mxErrors === 0).length / mx.length, `mx check clean on ${mx.filter((r) => r.scorecard!.mxErrors === 0).length} of ${plural(mx.length, 'run')}`]);
      if (!parts.length) return undefined;
      return { score: mean(parts.map(([v]) => v)) * 100, evidence: parts.map(([, l]) => l), n: (p ? p.checksPass + p.checksFail : 0) + mx.length };
    },
  }),
  'lead-tester': leadSpec({
    key: 'tests',
    label: 'Tests & bugs caught',
    weight: 0.15,
    measure: (f) => {
      const runs = (f.team?.floorRuns ?? []).filter((r) => (r.scorecard?.testsPassed ?? 0) + (r.scorecard?.testsFailed ?? 0) > 0);
      const kind = floorKind(f, 'tests', 'test task');
      if (!runs.length && !kind) return undefined;
      const passed = runs.reduce((n, r) => n + (r.scorecard!.testsPassed ?? 0), 0);
      const failed = runs.reduce((n, r) => n + (r.scorecard!.testsFailed ?? 0), 0);
      const parts = [kind?.score, runs.length ? (passed / (passed + failed)) * 100 : undefined].filter((v): v is number => v !== undefined);
      return { score: mean(parts), evidence: [...(kind?.evidence ?? []), ...(runs.length ? [`${passed} tests passing, ${failed} failing (bugs caught) across ${plural(runs.length, 'run')}`] : [])], n: (kind?.n ?? 0) + runs.length };
    },
  }),
  'chief-analyst': leadSpec({
    key: 'decisions',
    label: 'Decisions & gates',
    weight: 0.15,
    measure: (f) => {
      const d = f.team?.decisions;
      const g = f.team?.gates;
      const parts: [number, string][] = [];
      if (d && d.confirmed + d.assumed) parts.push([d.confirmed / (d.confirmed + d.assumed), `Decision register: ${d.confirmed} CONFIRMED, ${d.assumed} ASSUMED`]);
      if (g?.total) parts.push([g.pass / g.total, `${g.pass} of ${plural(g.total, 'toolkit gate')} passed`]);
      if (!parts.length) return undefined;
      return { score: mean(parts.map(([v]) => v)) * 100, evidence: parts.map(([, l]) => l), n: (d ? d.confirmed + d.assumed : 0) + (g?.total ?? 0) };
    },
  }),
};

/** A team role's specialist ranking; undefined for an ordinary worker. */
export function specialistOf(f: WorkerFacts): Specialist | undefined {
  if (f.role === 'worker') return undefined;
  const defs = SPECIALIST[f.role];
  const criteria: Criterion[] = defs.map((d) => {
    const m = d.measure(f);
    if (m === undefined || typeof m === 'string') return { key: d.key, label: d.label, weight: d.weight, evidence: [], missing: typeof m === 'string' ? m : 'nothing recorded for it yet' };
    const score = round1(clamp100(m.score));
    const confidence: Confidence = confidenceOf(m.n, 2, 5);
    return { key: d.key, label: d.label, weight: d.weight, score, grade: gradeOf(score), confidence, evidence: m.evidence };
  });
  const score = combine(criteria);
  return { label: `${ROLE_BY_ID.get(f.role)?.title ?? f.role} duties`, score, grade: score === undefined ? undefined : gradeOf(score), criteria };
}
