// Quality scores per commit (Testing release 1b): `mxcli report --format json` and `mxcli lint --format
// json`, run by the office in its own work folder checked out at a known commit (server/testing/
// quality-run.ts), never in a floor checkout. A record is bound to that commit, the mxcli version and the
// catalog schema, and there is one per commit and mxcli version. The header on the Testing tab shows the
// newest one, a small trend over the last recorded commits, lint counts by severity with the top rules,
// and, honestly, the rules that could not run. Pure (no Node imports): the server builds, the page shows.

/** The six report categories the header shows, in this order (the report's "Other" is kept, not headlined). */
export const SCORE_NAMES = ['Security', 'Quality', 'Architecture', 'Performance', 'Naming', 'Design'] as const;

export interface CategoryScore {
  name: string;
  score: number;
  /** Elements the category checked, and its findings by severity. */
  total?: number;
  errors?: number;
  warnings?: number;
  infos?: number;
  topActions?: string[];
}

export interface ReportScores {
  overall: number;
  categories: CategoryScore[];
  summary?: { total: number; errors: number; warnings: number; infos: number };
}

export interface LintSummary {
  bySeverity: { errors: number; warnings: number; infos: number; hints: number };
  total: number;
  /** The rules with the most findings, most first. */
  topRules: { ruleId: string; count: number; severity: string; example?: string }[];
}

/** A rule (or a catalog read) that could not run, so its findings are missing, not zero. */
export interface RuleFailure {
  rule: string;
  why: string;
  /** Which command said so. */
  from: 'report' | 'lint';
}

export interface QualityRecord {
  schemaVersion: 1;
  /** qr_<ulid>. */
  id: string;
  /** commit:mxcliVersion — a second run on the same pair is skipped. */
  sourceKey: string;
  commit: string;
  branch?: string;
  mxcliVersion: string;
  /** The catalog's schema_version (catalog_meta), when it could be read. */
  catalogSchema?: string;
  mendixVersion?: string;
  startedAt: string;
  finishedAt: string;
  /** Wall times, ms: the checkout, report, lint and the catalog read. */
  timings: Record<string, number>;
  report?: ReportScores;
  lint?: LintSummary;
  ruleFailures: RuleFailure[];
  /** A command that gave no usable JSON: why, in words (the record keeps what the other one said). */
  errors: string[];
  /** Where the raw JSON is kept in the office's data folder. */
  evidence: { report?: string; lint?: string };
  /** 'auto' (a new main commit) or the admin who asked. */
  trigger: string;
  /** Always the office's work folder, never a floor checkout. */
  workFolder: string;
  ingestedAt: number;
}

export type QualityDraft = Omit<QualityRecord, 'id' | 'ingestedAt' | 'schemaVersion'>;

export const qualityKey = (commit: string, mxcliVersion: string) => `${commit.toLowerCase()}:${mxcliVersion}`;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The scores from `mxcli report --format json`; undefined when it isn't that. */
export function parseReportJson(text: string): ReportScores | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  const overall = num(j?.overallScore);
  if (overall === undefined || !Array.isArray(j.categories)) return undefined;
  const categories = (j.categories as Record<string, unknown>[])
    .filter((c) => typeof c?.name === 'string' && num(c.score) !== undefined)
    .map((c) => ({
      name: String(c.name),
      score: num(c.score)!,
      ...(num(c.total) !== undefined ? { total: num(c.total) } : {}),
      ...(num(c.errors) !== undefined ? { errors: num(c.errors) } : {}),
      ...(num(c.warnings) !== undefined ? { warnings: num(c.warnings) } : {}),
      ...(num(c.infos) !== undefined ? { infos: num(c.infos) } : {}),
      ...(Array.isArray(c.topActions) ? { topActions: (c.topActions as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 3).map((a) => a.slice(0, 200)) } : {}),
    }));
  const s = j.summary as Record<string, unknown> | undefined;
  return { overall, categories, ...(s && num(s.total) !== undefined ? { summary: { total: num(s.total)!, errors: num(s.errors) ?? 0, warnings: num(s.warnings) ?? 0, infos: num(s.infos) ?? 0 } } : {}) };
}

export const TOP_RULES = 6;

/** The counts and top rules from `mxcli lint --format json`; undefined when it isn't that. */
export function parseLintJson(text: string): LintSummary | undefined {
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (!j || !Array.isArray(j.violations)) return undefined;
  const vs = j.violations as Record<string, unknown>[];
  const by = new Map<string, { count: number; severity: string; example?: string }>();
  const sev = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const v of vs) {
    const id = typeof v.ruleId === 'string' ? v.ruleId : 'unknown';
    const severity = typeof v.severity === 'string' ? v.severity.toLowerCase() : 'info';
    const e = by.get(id) ?? { count: 0, severity, ...(typeof v.message === 'string' ? { example: v.message.slice(0, 160) } : {}) };
    e.count++;
    by.set(id, e);
    if (severity === 'error') sev.errors++;
    else if (severity === 'warning') sev.warnings++;
    else if (severity === 'hint') sev.hints++;
    else sev.infos++;
  }
  const s = j.summary as Record<string, unknown> | undefined;
  const bySeverity = s && num(s.total) !== undefined ? { errors: num(s.errors) ?? 0, warnings: num(s.warnings) ?? 0, infos: num(s.infos) ?? 0, hints: num(s.hints) ?? 0 } : sev;
  const topRules = [...by].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0])).slice(0, TOP_RULES).map(([ruleId, e]) => ({ ruleId, ...e }));
  return { bySeverity, total: num(s?.total) ?? vs.length, topRules };
}

/**
 * Rules that could not run, from the JSON (`ruleFailures`, which newer mxcli versions write) and from
 * what the command said on stderr (this nightly: "lint could not read the catalog for X", "some rules
 * need 'full' catalog data that is unavailable", "Results are INCOMPLETE").
 */
export function ruleFailuresOf(from: 'report' | 'lint', json: string | undefined, stderr: string): RuleFailure[] {
  const out: RuleFailure[] = [];
  try {
    const j = json ? (JSON.parse(json) as { ruleFailures?: unknown }) : undefined;
    if (Array.isArray(j?.ruleFailures))
      for (const f of j.ruleFailures as Record<string, unknown>[]) {
        const rule = String(f?.ruleId ?? f?.rule ?? f?.id ?? 'unknown rule');
        out.push({ rule, why: String(f?.error ?? f?.message ?? f?.reason ?? 'could not run').slice(0, 300), from });
      }
  } catch {
    /* not JSON: the caller says so */
  }
  for (const line of stderr.split(/\r?\n/)) {
    const l = line.trim();
    let m = /could not read the catalog for (\S+?):\s*(.*)$/i.exec(l);
    if (m) {
      out.push({ rule: `catalog: ${m[1]}`, why: m[2].slice(0, 300) || 'catalog read failed', from });
      continue;
    }
    m = /^Warning: some rules need '([^']+)' catalog data that is unavailable/i.exec(l);
    if (m) out.push({ rule: `rules needing ${m[1]} catalog data`, why: 'their results may be incomplete', from });
    else if (/^Results are INCOMPLETE/i.test(l)) out.push({ rule: 'lint run', why: l.slice(0, 300), from });
    else if (/^warning: skipping .*\.star/i.test(l) || /starlark.*error/i.test(l)) out.push({ rule: 'Starlark rule', why: l.slice(0, 300), from });
  }
  return out;
}

// ---- The view: the header on the Testing tab ----

export interface ScoreCell {
  name: string;
  score?: number;
  /** Newest last: this category's score over the last recorded commits. */
  trend: { commit: string; score: number }[];
}

export interface QualityView {
  /** The newest record, its commit and mxcli version (every score in it comes from that commit). */
  latest?: {
    id: string;
    commit: string;
    mxcliVersion: string;
    catalogSchema?: string;
    mendixVersion?: string;
    finishedAt: string;
    trigger: string;
    timings: Record<string, number>;
    overall?: number;
    scores: ScoreCell[];
    overallTrend: { commit: string; score: number }[];
    lint?: LintSummary;
    ruleFailures: RuleFailure[];
    errors: string[];
    evidence: QualityRecord['evidence'];
  };
  /** main moved since the newest record's commit. */
  stale?: { main: string; scored: string };
  /** main's commit has no record yet for this mxcli version. */
  mainScored: boolean;
  totalRecords: number;
}

export const TREND_N = 10;

/** The header's view from every record (oldest first, as stored) and main's commit. */
export function buildQualityView(records: readonly QualityRecord[], main: string | undefined): QualityView {
  const usable = records.filter((r) => r.report || r.lint);
  const newest = [...usable].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt) || a.ingestedAt - b.ingestedAt);
  const latest = newest.at(-1);
  const sameSha = (a: string, b: string) => a.toLowerCase().startsWith(b.toLowerCase().slice(0, 12)) || b.toLowerCase().startsWith(a.toLowerCase().slice(0, 12));
  const mainScored = !!main && records.some((r) => sameSha(r.commit, main));
  if (!latest) return { mainScored, totalRecords: records.length };
  // The trend: one point per commit (its newest record), the last TREND_N commits.
  const perCommit = new Map<string, QualityRecord>();
  for (const r of newest) if (r.report) perCommit.set(r.commit, r);
  const last = [...perCommit.values()].slice(-TREND_N);
  const scores: ScoreCell[] = SCORE_NAMES.map((name) => ({
    name,
    ...(latest.report?.categories.find((c) => c.name === name) ? { score: latest.report.categories.find((c) => c.name === name)!.score } : {}),
    trend: last.flatMap((r) => {
      const c = r.report?.categories.find((x) => x.name === name);
      return c ? [{ commit: r.commit, score: c.score }] : [];
    }),
  }));
  return {
    latest: {
      id: latest.id,
      commit: latest.commit,
      mxcliVersion: latest.mxcliVersion,
      ...(latest.catalogSchema ? { catalogSchema: latest.catalogSchema } : {}),
      ...(latest.mendixVersion ? { mendixVersion: latest.mendixVersion } : {}),
      finishedAt: latest.finishedAt,
      trigger: latest.trigger,
      timings: latest.timings,
      ...(latest.report ? { overall: latest.report.overall } : {}),
      scores,
      overallTrend: last.map((r) => ({ commit: r.commit, score: r.report!.overall })),
      ...(latest.lint ? { lint: latest.lint } : {}),
      ruleFailures: latest.ruleFailures,
      errors: latest.errors,
      evidence: latest.evidence,
    },
    ...(main && !sameSha(latest.commit, main) ? { stale: { main, scored: latest.commit } } : {}),
    mainScored,
    totalRecords: records.length,
  };
}

/** The state of the office's own mxcli runs for a floor, for the tab's buttons. */
export interface MxcliRunState {
  /** Whether this office can run mxcli here at all, and why not. */
  available: boolean;
  why?: string;
  /** While running: how far it has got (in words) and its time limit; a subset run: which files (release 82). */
  tests: { running: boolean; since?: number; commit?: string; last?: string; progress?: string; limitMinutes?: number; limitAuto?: boolean; subset?: string };
  quality: { running: boolean; since?: number; commit?: string; last?: string; deferred?: string };
}

/** GET /api/testing?part=quality. */
export interface QualityPart {
  quality: QualityView;
  runs: MxcliRunState;
  /** Whoever's looking may start a run (an admin). */
  admin: boolean;
  /** Whether the office scores each new main commit by itself ("Score main automatically with mxcli", off by default). */
  auto?: boolean;
  main?: string;
  /** The project's own time limit for microflow test runs (minutes); undefined: sized to the suite. */
  testLimit?: number;
}
