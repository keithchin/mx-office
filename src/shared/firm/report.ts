// The Firm's audit report: its schema, and the checks every section a reviewer sends goes through
// (`office-workers firm report --section <key> --file <json>`, checked on the server before it's
// kept). Specialists send one `reviewer` section each; the Engagement Partner sends the report's own
// sections, consolidating theirs. Pure: the server, the report viewer and the tests share it.

import type { TeamId } from '../roster/roles.js';
import type { ReviewerId } from './roles.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const EFFORTS = ['S', 'M', 'L'] as const;
export const LEVELS = ['low', 'medium', 'high'] as const;
export type Level = (typeof LEVELS)[number];
export const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
export const PRIORITIES = ['now', 'next', 'later'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const OWNERS = ['management', 'design', 'development', 'testing', 'analysis', 'pm'] as const;
export type Owner = (typeof OWNERS)[number];
export const VERDICTS = ['on-track', 'at-risk', 'off-track'] as const;
export const MILESTONE_STATUS = ['done', 'on-track', 'at-risk', 'late'] as const;
export const GAPS = ['exceeded', 'met', 'partial', 'missed'] as const;

export interface Evidence {
  text: string;
  file?: string;
  line?: number;
  pr?: number;
  issue?: number;
  url?: string;
}
export interface Finding {
  id: string;
  severity: Severity;
  team: Owner;
  title: string;
  evidence: Evidence[];
  recommendation: string;
  effort: (typeof EFFORTS)[number];
  /** Which reviewer found it (filled in by the office from who sent it, when missing). */
  reviewer?: ReviewerId;
}
export interface RootCause {
  problem: string;
  /** Each "why?", from the symptom down. */
  chain: string[];
  rootCause: string;
  fix: string;
}
export interface Milestone {
  name: string;
  planned?: string;
  forecast?: string;
  status: (typeof MILESTONE_STATUS)[number];
  confidence: Level;
  note?: string;
}
export interface Expectation {
  area: string;
  expected: string;
  actual: string;
  gap: (typeof GAPS)[number];
  note?: string;
}
export interface WorkerGrade {
  name: string;
  role?: string;
  model?: string;
  grade: (typeof GRADES)[number];
  /** The office's own A–F grade from the ranking, for comparison. */
  rankingGrade?: string;
  output: string;
  spend?: number;
  slacking: boolean;
  evidence: string;
}
export interface Risk {
  title: string;
  likelihood: Level;
  impact: Level;
  mitigation: string;
  team?: Owner;
}
export interface Recommendation {
  priority: Priority;
  title: string;
  detail: string;
  owner: Owner;
  effort?: (typeof EFFORTS)[number];
}
export interface ArtifactRef {
  title: string;
  kind: string;
  /** Inside the engagement folder (reviewer/out/…), or a URL. */
  path: string;
  note?: string;
}
export interface AppStats {
  modules?: number;
  entities?: number;
  pages?: number;
  microflows?: number;
  loc?: number;
  tests?: { count: number; passRate?: number };
  prsMerged?: number;
  prsOpen?: number;
  issuesOpen?: number;
  issuesClosed?: number;
  buildHealth?: 'green' | 'amber' | 'red';
  ciPassRate?: number;
  costToDate?: number;
  auditCost?: number;
  extra?: { label: string; value: string }[];
}
export interface Executive {
  verdict: (typeof VERDICTS)[number];
  headline: string;
  summary: string;
  keyPoints: string[];
}

/** One specialist's part, which the Partner consolidates. */
export interface ReviewerSection {
  summary: string;
  findings: Finding[];
  pros: string[];
  cons: string[];
  rootCauses: RootCause[];
  workers: WorkerGrade[];
  risks: Risk[];
  recommendations: Recommendation[];
  artifacts: ArtifactRef[];
  stats?: AppStats;
}

export interface Report {
  id: string;
  engagement: string;
  floor: string;
  floorName: string;
  repo?: string;
  commit?: string;
  generatedAt: number;
  /** Cut short (budget, time, cancel): put together from what the reviewers had sent. */
  partial?: boolean;
  /** A sample for screenshots and demos, not a real audit. */
  sample?: boolean;
  reviewers: { id: ReviewerId; name: string; title: string; model: string; cost: number }[];
  executive: Executive;
  statistics: AppStats;
  findings: Finding[];
  prosCons: { pros: string[]; cons: string[] };
  rootCauses: RootCause[];
  timeline: { summary?: string; milestones: Milestone[] };
  expectations: Expectation[];
  workers: WorkerGrade[];
  risks: Risk[];
  recommendations: Recommendation[];
  appendix: ArtifactRef[];
  /** Every specialist's own section, as sent. */
  sections: Partial<Record<ReviewerId, ReviewerSection>>;
}

/** The sections the Partner sends, in the report's order. */
export const PARTNER_SECTIONS = ['executive', 'statistics', 'findings', 'prosCons', 'rootCauses', 'timeline', 'expectations', 'workers', 'risks', 'recommendations', 'appendix'] as const;
export type PartnerSection = (typeof PARTNER_SECTIONS)[number];
export type SectionKey = PartnerSection | 'reviewer';
export const SECTION_KEYS: readonly SectionKey[] = [...PARTNER_SECTIONS, 'reviewer'];
/** The ones a report can't go out without. */
export const REQUIRED_SECTIONS: readonly PartnerSection[] = ['executive', 'findings', 'recommendations'];

// ---- Checking what a reviewer sent ----------------------------------------------------------

class Bad extends Error {}
type At = string;
const fail = (at: At, what: string): never => {
  throw new Bad(`${at} ${what}`);
};
const obj = (v: unknown, at: At): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(at, 'must be an object'));
function str(v: unknown, at: At, max = 4000): string {
  if (typeof v !== 'string' || !v.trim()) return fail(at, 'must be a non-empty string');
  return v.trim().slice(0, max);
}
const optStr = (v: unknown, at: At, max = 4000) => (v === undefined || v === null || v === '' ? undefined : str(v, at, max));
function optNum(v: unknown, at: At, lo = 0, hi = 1e12): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return fail(at, `must be a number from ${lo} to ${hi}`);
  return v;
}
function one<T extends string>(v: unknown, all: readonly T[], at: At): T {
  return all.includes(v as T) ? (v as T) : fail(at, `must be one of ${all.join(', ')}`);
}
function arr<T>(v: unknown, at: At, each: (x: unknown, at: At) => T, max = 200): T[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return fail(at, 'must be an array');
  return v.slice(0, max).map((x, i) => each(x, `${at}[${i}]`));
}
const strs = (v: unknown, at: At, max = 60) => arr(v, at, (x, a) => str(x, a, 1000), max);

function evidence(v: unknown, at: At): Evidence {
  if (typeof v === 'string') return { text: str(v, at, 1000) };
  const o = obj(v, at);
  return { text: str(o.text, `${at}.text`, 1000), file: optStr(o.file, `${at}.file`, 300), line: optNum(o.line, `${at}.line`, 1, 1e7), pr: optNum(o.pr, `${at}.pr`, 1, 1e7), issue: optNum(o.issue, `${at}.issue`, 1, 1e7), url: optStr(o.url, `${at}.url`, 500) };
}
function finding(v: unknown, at: At): Finding {
  const o = obj(v, at);
  const ev = arr(o.evidence, `${at}.evidence`, evidence, 20);
  if (!ev.length) fail(`${at}.evidence`, 'needs at least one piece of evidence');
  return {
    id: str(o.id, `${at}.id`, 24),
    severity: one(o.severity, SEVERITIES, `${at}.severity`),
    team: one(o.team, OWNERS, `${at}.team`),
    title: str(o.title, `${at}.title`, 200),
    evidence: ev,
    recommendation: str(o.recommendation, `${at}.recommendation`, 2000),
    effort: one(o.effort, EFFORTS, `${at}.effort`),
    ...(o.reviewer !== undefined ? { reviewer: o.reviewer as ReviewerId } : {}),
  };
}
function rootCause(v: unknown, at: At): RootCause {
  const o = obj(v, at);
  const chain = strs(o.chain, `${at}.chain`, 10);
  if (!chain.length) fail(`${at}.chain`, 'needs at least one "why"');
  return { problem: str(o.problem, `${at}.problem`, 300), chain, rootCause: str(o.rootCause, `${at}.rootCause`, 1000), fix: str(o.fix, `${at}.fix`, 1000) };
}
function milestone(v: unknown, at: At): Milestone {
  const o = obj(v, at);
  return { name: str(o.name, `${at}.name`, 200), planned: optStr(o.planned, `${at}.planned`, 40), forecast: optStr(o.forecast, `${at}.forecast`, 40), status: one(o.status, MILESTONE_STATUS, `${at}.status`), confidence: one(o.confidence, LEVELS, `${at}.confidence`), note: optStr(o.note, `${at}.note`, 500) };
}
function expectation(v: unknown, at: At): Expectation {
  const o = obj(v, at);
  return { area: str(o.area, `${at}.area`, 60), expected: str(o.expected, `${at}.expected`, 600), actual: str(o.actual, `${at}.actual`, 600), gap: one(o.gap, GAPS, `${at}.gap`), note: optStr(o.note, `${at}.note`, 600) };
}
function worker(v: unknown, at: At): WorkerGrade {
  const o = obj(v, at);
  if (typeof o.slacking !== 'boolean') fail(`${at}.slacking`, 'must be true or false');
  return {
    name: str(o.name, `${at}.name`, 60),
    role: optStr(o.role, `${at}.role`, 60),
    model: optStr(o.model, `${at}.model`, 60),
    grade: one(o.grade, GRADES, `${at}.grade`),
    rankingGrade: optStr(o.rankingGrade, `${at}.rankingGrade`, 4),
    output: str(o.output, `${at}.output`, 600),
    spend: optNum(o.spend, `${at}.spend`),
    slacking: o.slacking as boolean,
    evidence: str(o.evidence, `${at}.evidence`, 1500),
  };
}
function risk(v: unknown, at: At): Risk {
  const o = obj(v, at);
  return { title: str(o.title, `${at}.title`, 200), likelihood: one(o.likelihood, LEVELS, `${at}.likelihood`), impact: one(o.impact, LEVELS, `${at}.impact`), mitigation: str(o.mitigation, `${at}.mitigation`, 1000), ...(o.team !== undefined ? { team: one(o.team, OWNERS, `${at}.team`) } : {}) };
}
function recommendation(v: unknown, at: At): Recommendation {
  const o = obj(v, at);
  return { priority: one(o.priority, PRIORITIES, `${at}.priority`), title: str(o.title, `${at}.title`, 200), detail: str(o.detail, `${at}.detail`, 2000), owner: one(o.owner, OWNERS, `${at}.owner`), ...(o.effort !== undefined ? { effort: one(o.effort, EFFORTS, `${at}.effort`) } : {}) };
}
function artifact(v: unknown, at: At): ArtifactRef {
  const o = obj(v, at);
  return { title: str(o.title, `${at}.title`, 200), kind: str(o.kind, `${at}.kind`, 40), path: str(o.path, `${at}.path`, 500), note: optStr(o.note, `${at}.note`, 500) };
}
function stats(v: unknown, at: At): AppStats {
  const o = obj(v, at);
  const n = (k: string, hi = 1e9) => optNum(o[k], `${at}.${k}`, 0, hi);
  const t = o.tests === undefined ? undefined : obj(o.tests, `${at}.tests`);
  const out: AppStats = {
    modules: n('modules'), entities: n('entities'), pages: n('pages'), microflows: n('microflows'), loc: n('loc'),
    prsMerged: n('prsMerged'), prsOpen: n('prsOpen'), issuesOpen: n('issuesOpen'), issuesClosed: n('issuesClosed'),
    ciPassRate: n('ciPassRate', 1), costToDate: n('costToDate'), auditCost: n('auditCost'),
    ...(t ? { tests: { count: optNum(t.count, `${at}.tests.count`) ?? 0, passRate: optNum(t.passRate, `${at}.tests.passRate`, 0, 1) } } : {}),
    ...(o.buildHealth !== undefined ? { buildHealth: one(o.buildHealth, ['green', 'amber', 'red'] as const, `${at}.buildHealth`) } : {}),
    extra: arr(o.extra, `${at}.extra`, (x, a) => {
      const e = obj(x, a);
      return { label: str(e.label, `${a}.label`, 60), value: str(String(e.value ?? ''), `${a}.value`, 200) };
    }, 30),
  };
  for (const k of Object.keys(out) as (keyof AppStats)[]) if (out[k] === undefined) delete out[k];
  return out;
}

const CHECK: { [K in SectionKey]: (v: unknown, at: At) => unknown } = {
  executive: (v, at) => {
    const o = obj(v, at);
    return { verdict: one(o.verdict, VERDICTS, `${at}.verdict`), headline: str(o.headline, `${at}.headline`, 200), summary: str(o.summary, `${at}.summary`, 6000), keyPoints: strs(o.keyPoints, `${at}.keyPoints`, 12) } satisfies Executive;
  },
  statistics: stats,
  findings: (v, at) => arr(v, at, finding),
  prosCons: (v, at) => {
    const o = obj(v, at);
    return { pros: strs(o.pros, `${at}.pros`), cons: strs(o.cons, `${at}.cons`) };
  },
  rootCauses: (v, at) => arr(v, at, rootCause, 20),
  timeline: (v, at) => {
    const o = obj(v, at);
    return { summary: optStr(o.summary, `${at}.summary`, 2000), milestones: arr(o.milestones, `${at}.milestones`, milestone, 40) };
  },
  expectations: (v, at) => arr(v, at, expectation, 30),
  workers: (v, at) => arr(v, at, worker, 60),
  risks: (v, at) => arr(v, at, risk, 40),
  recommendations: (v, at) => arr(v, at, recommendation, 60),
  appendix: (v, at) => arr(v, at, artifact, 100),
  reviewer: (v, at) => {
    const o = obj(v, at);
    return {
      summary: str(o.summary, `${at}.summary`, 6000),
      findings: arr(o.findings, `${at}.findings`, finding),
      pros: strs(o.pros, `${at}.pros`),
      cons: strs(o.cons, `${at}.cons`),
      rootCauses: arr(o.rootCauses, `${at}.rootCauses`, rootCause, 20),
      workers: arr(o.workers, `${at}.workers`, worker, 60),
      risks: arr(o.risks, `${at}.risks`, risk, 40),
      recommendations: arr(o.recommendations, `${at}.recommendations`, recommendation, 60),
      artifacts: arr(o.artifacts, `${at}.artifacts`, artifact, 100),
      ...(o.stats !== undefined ? { stats: stats(o.stats, `${at}.stats`) } : {}),
    } satisfies ReviewerSection;
  },
};

export const isSectionKey = (v: unknown): v is SectionKey => typeof v === 'string' && (SECTION_KEYS as readonly string[]).includes(v);

/** A section as sent, checked and cleaned; or what's wrong with it, naming the field. */
export function validateSection(key: unknown, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!isSectionKey(key)) return { ok: false, error: `--section is one of ${SECTION_KEYS.join(', ')}` };
  try {
    return { ok: true, value: CHECK[key](raw, key) };
  } catch (err) {
    if (err instanceof Bad) return { ok: false, error: err.message };
    throw err;
  }
}

/** An empty report, for the office to fill in before (or instead of) the Partner. */
export function emptyReport(base: Pick<Report, 'id' | 'engagement' | 'floor' | 'floorName' | 'repo' | 'commit' | 'generatedAt'>): Report {
  return {
    ...base,
    reviewers: [],
    executive: { verdict: 'at-risk', headline: 'No executive summary was written', summary: 'The Engagement Partner did not send an executive summary.', keyPoints: [] },
    statistics: {},
    findings: [],
    prosCons: { pros: [], cons: [] },
    rootCauses: [],
    timeline: { milestones: [] },
    expectations: [],
    workers: [],
    risks: [],
    recommendations: [],
    appendix: [],
    sections: {},
  };
}

/** Findings by severity, most severe first. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
export const bySeverity = (a: Finding, b: Finding) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id);

/** A report that has only the specialists' sections: their findings, pros, cons and the rest merged, for a partial report. */
export function mergeSections(r: Report): Report {
  const all = Object.entries(r.sections) as [ReviewerId, ReviewerSection][];
  const take = <T>(f: (s: ReviewerSection) => T[], have: T[]) => (have.length ? have : all.flatMap(([, s]) => f(s)));
  return {
    ...r,
    findings: (r.findings.length ? r.findings : all.flatMap(([id, s]) => s.findings.map((f) => ({ ...f, reviewer: f.reviewer ?? id })))).sort(bySeverity),
    prosCons: { pros: take((s) => s.pros, r.prosCons.pros), cons: take((s) => s.cons, r.prosCons.cons) },
    rootCauses: take((s) => s.rootCauses, r.rootCauses),
    workers: take((s) => s.workers, r.workers),
    risks: take((s) => s.risks, r.risks),
    recommendations: take((s) => s.recommendations, r.recommendations),
    appendix: take((s) => s.artifacts, r.appendix),
  };
}
