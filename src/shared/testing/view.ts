// The Testing tab's view (App Insights › Testing), worked out from the test-run records and what the
// files at main say. Coverage, result and freshness are three separate answers and never stand in for
// each other: coverage asks whether a linked test definition exists, result what the latest linked run
// said, freshness whether that run tested the commit main is at (and whether its tested revision is
// known at all). A criterion with no linked test has coverage "none" and result "none", never "failed".
// Pure: the server builds it (server/testing/), the page only shows it.

import type { AcRow, Brd } from './links.js';
import { isKnown, sameRevision, UNKNOWN, type Link, type Revision, type RunSource, type TestRunRecord } from './record.js';

export type Coverage = 'linked' | 'inferred' | 'none';
export type UcCoverage = 'full' | 'partial' | 'inferred' | 'none';
export type ResultState = 'passed' | 'failed' | 'skipped' | 'none';
export type Freshness = 'current' | 'stale' | 'unknown' | 'none';

/** A test definition found at main: a journey or test file, with what it names. */
export interface TestDef {
  path: string;
  /** J-01, for a journey file. */
  journey?: string;
  kind: 'journey' | 'unit' | 'e2e' | 'script' | 'other';
  links: Link[];
}

export interface TestRef {
  /** The file, or the test's name in a run. */
  name: string;
  basis: 'recorded' | 'inferred';
  via: string;
  rule?: string;
}

export interface Latest {
  result: ResultState;
  freshness: Freshness;
  /** The record the latest result came from. */
  runId?: string;
  tested?: Revision;
}

export interface AcView extends Latest {
  id: string;
  text: string;
  journeys: string[];
  coverage: Coverage;
  tests: TestRef[];
}

export interface UcRow extends Latest {
  id: string;
  title: string;
  rules: string[];
  acs: AcView[];
  tests: TestRef[];
  coverage: UcCoverage;
  /** "2 of 3 acceptance criteria linked". */
  coverageNote: string;
  flaky: boolean;
  /** The runs with a result linked to this row, newest first (at most RUNS_PER_ROW). */
  runIds: string[];
}

export interface FeatureGroup {
  id: string;
  title: string;
  file: string;
  rows: UcRow[];
}

export interface RunSummary {
  id: string;
  source: RunSource;
  suite: string;
  tested: Revision;
  definition: Revision;
  evidence: TestRunRecord['evidence'];
  branch?: string;
  pr?: number;
  at?: string;
  ingestedAt: number;
  counts: { passed: number; failed: number; skipped: number };
  /** Results that were harness errors (counted here, not under skipped): never passed, never a business failure. */
  harness?: number;
  /** The whole run could not complete (an office-launched run): a harness error, not failed tests. */
  harnessError?: string;
  /** What ran it (an office-launched run): mxcli version, runtime, Mendix version. */
  environment?: TestRunRecord['environment'];
  /** A few results by stable id, for a run the office launched (mxcli-test): failures and harness errors first. */
  tests?: { name: string; status: TestRunRecord['results'][number]['status']; harness?: true; detail?: string; assertions?: number }[];
  /** Tests in this run that passed and failed on the same tested revision. */
  flaky: string[];
  freshness: Freshness;
  /** Run-wide links (a PR title naming BR012), each saying recorded or inferred. */
  links: Link[];
  actor: string;
}

export interface GateVerdict {
  status: string;
  detail?: string;
  /** "rendered by the office at <sha>", "index.html at main". */
  from: string;
}

/** The toolkit's test plan at main (its text is asked for separately, only when the panel opens). */
export interface PlanInfo {
  path: string;
  /** Its own "Status:" line, when it has one. */
  status?: string;
  bytes: number;
  /** The commit that last changed it, and when. */
  changedIn?: string;
  changedAt?: string;
}

export interface TestingFacts {
  main?: { branch: string; sha: string };
  brds: Brd[];
  acs: AcRow[];
  tests: TestDef[];
  plan?: PlanInfo;
  gate6?: GateVerdict;
  notes: string[];
}

export interface TestingView {
  floor: string;
  main?: { branch: string; sha: string };
  /** main's commit and the newest record id: a new run on an unchanged commit changes it. */
  cacheKey: string;
  gate6?: GateVerdict;
  /** Runs on exactly main's commit, by suite (the checks CI or the office ran there). */
  checksOnMain: { suite: string; source: RunSource; result: ResultState; runId: string; harness?: true }[];
  counts: {
    /** Per acceptance criterion. */
    coverage: Record<Coverage, number>;
    /** Per use case. */
    useCases: Record<UcCoverage, number>;
    result: Record<ResultState, number>;
    freshness: Record<Freshness, number>;
  };
  /** Main moved since the newest run with a known tested revision. */
  stale?: { lastTested: Revision; runId: string };
  plan?: PlanInfo;
  features: FeatureGroup[];
  /** Criteria tied to no use case. */
  unassigned: AcView[];
  runs: RunSummary[];
  totalRuns: number;
  notes: string[];
}

export const RUNS_SHOWN = 60;
export const RUNS_PER_ROW = 10;
/** Results listed per office-launched run in the view (the rest stay in the record and its JUnit file). */
export const TESTS_PER_RUN = 40;

const when = (r: TestRunRecord) => Date.parse(r.finishedAt ?? r.startedAt ?? '') || r.ingestedAt;

/** Newest first: by when it ran, then when it was taken in. */
export const newestFirst = (rs: readonly TestRunRecord[]) => [...rs].sort((a, b) => when(b) - when(a) || b.ingestedAt - a.ingestedAt);

export function freshnessOf(tested: Revision | undefined, main: string | undefined): Freshness {
  if (!isKnown(tested)) return 'unknown';
  if (!main) return 'unknown';
  return sameRevision(tested, main) ? 'current' : 'stale';
}

/** Tests that passed and failed on the same known tested revision, as "suite::name@revision" (testKey). */
export function flakyTests(records: readonly TestRunRecord[]): Set<string> {
  const seen = new Map<string, Set<string>>();
  for (const r of records) {
    if (!isKnown(r.testedRevision)) continue;
    for (const t of r.results) {
      if (t.status === 'skipped') continue;
      const k = testKey(r, t.name);
      const s = seen.get(k) ?? new Set<string>();
      s.add(t.status);
      seen.set(k, s);
    }
  }
  const out = new Set<string>();
  for (const [k, s] of seen) if (s.has('passed') && s.has('failed')) out.add(k);
  return out;
}

/** A test on the revision it tested: flaky is per test and per tested revision, never across revisions. */
const testKey = (r: TestRunRecord, name: string) => `${r.suite}::${name}@${isKnown(r.testedRevision) ? r.testedRevision.slice(0, 7).toLowerCase() : UNKNOWN}`;

/** What ties to a set of ids: test definitions and run results, and through which links. */
function linkedTo(ids: Set<string>, tests: readonly TestDef[], records: readonly TestRunRecord[]) {
  const refs: TestRef[] = [];
  for (const t of tests) {
    if (t.journey && ids.has(t.journey)) refs.push({ name: t.path, basis: 'recorded', via: `journey ${t.journey}` });
    else {
      const l = t.links.find((x) => ids.has(x.target));
      if (l) refs.push({ name: t.path, basis: l.basis, via: l.via, ...(l.rule ? { rule: l.rule } : {}) });
    }
  }
  // Run results: the newest first, and each test once.
  const hits: { r: TestRunRecord; status: TestRunRecord['results'][number]['status']; name: string; link: Link }[] = [];
  for (const r of records) {
    for (const t of r.results) {
      const link = t.links.find((x) => ids.has(x.target)) ?? r.links.find((x) => ids.has(x.target));
      if (link) hits.push({ r, status: t.status, name: t.name, link });
    }
  }
  for (const h of hits) {
    if (refs.some((x) => x.name === h.name)) continue;
    if (refs.length >= 40) break;
    refs.push({ name: h.name, basis: h.link.basis, via: h.link.via, ...(h.link.rule ? { rule: h.link.rule } : {}) });
  }
  return { refs, hits };
}

/** The latest result among linked run results (records already newest first). */
function latestOf(hits: ReturnType<typeof linkedTo>['hits'], main: string | undefined): Latest {
  const byRun = new Map<string, { r: TestRunRecord; statuses: Set<string> }>();
  for (const h of hits) {
    const e = byRun.get(h.r.id) ?? { r: h.r, statuses: new Set<string>() };
    e.statuses.add(h.status);
    byRun.set(h.r.id, e);
  }
  const runs = [...byRun.values()];
  const decided = runs.find((e) => e.statuses.has('failed') || e.statuses.has('passed')) ?? runs[0];
  if (!decided) return { result: 'none', freshness: 'none' };
  const result: ResultState = decided.statuses.has('failed') ? 'failed' : decided.statuses.has('passed') ? 'passed' : 'skipped';
  return { result, freshness: freshnessOf(decided.r.testedRevision, main), runId: decided.r.id, tested: decided.r.testedRevision };
}

const coverageOf = (refs: TestRef[]): Coverage => (refs.some((r) => r.basis === 'recorded') ? 'linked' : refs.length ? 'inferred' : 'none');

/** The Testing tab's view, from the facts at main and every record, for floor `floor`. */
export function buildTestingView(floor: string, facts: TestingFacts, all: readonly TestRunRecord[]): TestingView {
  const records = newestFirst(all);
  const main = facts.main?.sha;
  const flaky = flakyTests(records);
  const newestId = all.length ? all[all.length - 1].id : 'none';

  // Each criterion: its journeys, the tests and results linked to it or to them.
  const acViews = new Map<string, AcView & { hitIds: string[]; flaky: boolean }>();
  for (const ac of facts.acs) {
    const ids = new Set([ac.id, ...ac.journeys]);
    const { refs, hits } = linkedTo(ids, facts.tests, records);
    const coverage = coverageOf(refs);
    // No linked test: no result either, whatever any run said (T2).
    const latest: Latest = coverage === 'none' ? { result: 'none', freshness: 'none' } : latestOf(hits, main);
    acViews.set(ac.id, { id: ac.id, text: ac.text, journeys: ac.journeys, coverage, tests: refs, ...latest, hitIds: hits.map((h) => h.r.id), flaky: hits.some((h) => flaky.has(testKey(h.r, h.name))) });
  }

  // Which criteria belong to which use case: named by it, or proved by a journey / test tied to the use case or its rules.
  const ucOfAc = (ucIds: Set<string>, ac: AcRow): boolean => {
    if (ac.names.some((n) => ucIds.has(n))) return true;
    const via = new Set([ac.id, ...ac.journeys]);
    return facts.tests.some((t) => (t.journey ? via.has(t.journey) : t.links.some((l) => l.target === ac.id && l.basis === 'recorded')) && t.links.some((l) => l.basis === 'recorded' && ucIds.has(l.target)));
  };

  const assigned = new Set<string>();
  const features: FeatureGroup[] = facts.brds.map((brd) => ({
    id: brd.id,
    title: brd.title,
    file: brd.file,
    rows: brd.useCases.map((uc): UcRow => {
      const ucIds = new Set([uc.id, ...uc.rules]);
      const acs = facts.acs.filter((ac) => ucOfAc(ucIds, ac)).map((ac) => acViews.get(ac.id)!);
      acs.forEach((a) => assigned.add(a.id));
      const ids = new Set([...ucIds, ...acs.flatMap((a) => [a.id, ...a.journeys])]);
      const { refs, hits } = linkedTo(ids, facts.tests, records);
      const linkedAcs = acs.filter((a) => a.coverage === 'linked').length;
      const inferredAcs = acs.filter((a) => a.coverage === 'inferred').length;
      const recorded = refs.some((r) => r.basis === 'recorded');
      let coverage: UcCoverage;
      if (acs.length) coverage = linkedAcs === acs.length ? 'full' : linkedAcs ? 'partial' : inferredAcs || refs.length ? (recorded ? 'partial' : 'inferred') : 'none';
      else coverage = recorded ? 'full' : refs.length ? 'inferred' : 'none';
      const coverageNote = acs.length
        ? `${linkedAcs} of ${acs.length} acceptance criteria linked${inferredAcs ? `, ${inferredAcs} inferred only` : ''}`
        : refs.length
          ? `no acceptance criteria; ${refs.length} test${refs.length === 1 ? '' : 's'} name it`
          : 'no acceptance criteria and no test name it';
      const latest: Latest = coverage === 'none' ? { result: 'none', freshness: 'none' } : latestOf(hits, main);
      const runIds = [...new Set(hits.map((h) => h.r.id))].slice(0, RUNS_PER_ROW);
      return { id: uc.id, title: uc.title, rules: uc.rules, acs: acs.map(strip), tests: refs, coverage, coverageNote, ...latest, flaky: hits.some((h) => flaky.has(testKey(h.r, h.name))), runIds };
    }),
  }));
  const unassigned = facts.acs.filter((ac) => !assigned.has(ac.id)).map((ac) => strip(acViews.get(ac.id)!));

  const counts: TestingView['counts'] = {
    coverage: { linked: 0, inferred: 0, none: 0 },
    useCases: { full: 0, partial: 0, inferred: 0, none: 0 },
    result: { passed: 0, failed: 0, skipped: 0, none: 0 },
    freshness: { current: 0, stale: 0, unknown: 0, none: 0 },
  };
  for (const a of acViews.values()) counts.coverage[a.coverage]++;
  for (const g of features)
    for (const r of g.rows) {
      counts.useCases[r.coverage]++;
      counts.result[r.result]++;
      counts.freshness[r.freshness]++;
    }

  const runs: RunSummary[] = records.slice(0, RUNS_SHOWN).map((r) => summary(r, main, flaky));
  const checksOnMain: TestingView['checksOnMain'] = [];
  if (main)
    for (const r of records) {
      if (!sameRevision(r.testedRevision, main) || checksOnMain.some((c) => c.suite === r.suite)) continue;
      const sum = summary(r, main, flaky);
      const s = sum.counts;
      checksOnMain.push({ suite: r.suite, source: r.source, result: s.failed ? 'failed' : s.passed ? 'passed' : s.skipped ? 'skipped' : 'none', runId: r.id, ...(sum.harness || sum.harnessError ? { harness: true as const } : {}) });
    }
  const newestKnown = records.find((r) => isKnown(r.testedRevision));
  const stale = main && newestKnown && !records.some((r) => sameRevision(r.testedRevision, main)) ? { lastTested: newestKnown.testedRevision, runId: newestKnown.id } : undefined;

  return {
    floor,
    ...(facts.main ? { main: facts.main } : {}),
    cacheKey: `${main ?? 'no-main'}:${newestId}`,
    ...(facts.gate6 ? { gate6: facts.gate6 } : {}),
    checksOnMain,
    counts,
    ...(stale ? { stale } : {}),
    ...(facts.plan ? { plan: facts.plan } : {}),
    features,
    unassigned,
    runs,
    totalRuns: records.length,
    notes: facts.notes,
  };
}

function strip(a: AcView & { hitIds?: string[]; flaky?: boolean }): AcView {
  const { hitIds: _h, flaky: _f, ...rest } = a;
  return rest;
}

function summary(r: TestRunRecord, main: string | undefined, flaky: Set<string>): RunSummary {
  const counts = { passed: 0, failed: 0, skipped: 0 };
  let harness = 0;
  for (const t of r.results) {
    if (t.harness) harness++;
    else counts[t.status]++;
  }
  const rank = (t: TestRunRecord['results'][number]) => (t.status === 'failed' ? 0 : t.harness ? 1 : t.status === 'skipped' ? 2 : 3);
  const tests =
    r.source === 'mxcli-test'
      ? [...r.results]
          .sort((a, b) => rank(a) - rank(b))
          .slice(0, TESTS_PER_RUN)
          .map((t) => ({ name: t.name, status: t.status, ...(t.harness ? { harness: true as const } : {}), ...(t.detail ? { detail: t.detail.slice(0, 300) } : {}), ...(t.assertions !== undefined ? { assertions: t.assertions } : {}) }))
      : undefined;
  return {
    id: r.id,
    source: r.source,
    suite: r.suite,
    tested: r.testedRevision,
    definition: r.definitionRevision,
    evidence: r.evidence,
    ...(r.branch ? { branch: r.branch } : {}),
    ...(r.pr ? { pr: r.pr } : {}),
    ...(r.finishedAt || r.startedAt ? { at: r.finishedAt ?? r.startedAt } : {}),
    ingestedAt: r.ingestedAt,
    counts,
    ...(harness ? { harness } : {}),
    ...(r.harnessError ? { harnessError: r.harnessError } : {}),
    ...(r.environment ? { environment: r.environment } : {}),
    ...(tests ? { tests } : {}),
    flaky: [...new Set(r.results.filter((t) => flaky.has(testKey(r, t.name))).map((t) => t.name))].slice(0, 20),
    freshness: freshnessOf(r.testedRevision, main),
    links: r.links,
    actor: r.actor.name,
  };
}

