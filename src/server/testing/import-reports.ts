// Report files in the repository as test-run records: the JSON reports under reports/testing/ (the
// checks scripts' { capturedAt, run, results: [{ name, ok, detail }] } and the journey runner's
// *-findings.json) and the toolkit's test report, docs/report.json (report-schema.md: checks[] with a
// verdict). The evidence revision is the commit that last added or changed the file. A file committed
// at B proves nothing about B: the tested revision is taken only from what the file itself declares
// (appRevision, testedRevision, or report.json's project.gitCommit), else it's 'unknown' and the record
// counts as evidence for no commit. The definition revision likewise (testRevision; report.json's
// gitCommit names the whole repository, tests included).

import { inferredLinks, journeyIdOf, mergeLinks, recordedLinks, type Brd } from '../../shared/testing/links.js';
import { IMPORTER_VERSION, statusOf, UNKNOWN, type Link, type TestResult, type TestRunDraft } from '../../shared/testing/record.js';

/** Where report files are looked for, at main. */
export const REPORT_PATHS = ['reports/testing', 'docs/report.json'];
export const MAX_REPORTS = 300;
const MAX_RESULTS = 500;

export interface ParsedReport {
  suite: string;
  /** What the file says it tested, and which tests it ran (as written: may be short). */
  declaredApp?: string;
  declaredTests?: string;
  startedAt?: string;
  finishedAt?: string;
  results: TestResult[];
  links: Link[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const rev = (v: unknown) => {
  const s = str(v);
  return s && /^[0-9a-f]{7,64}$/i.test(s) ? s : undefined;
};

/** A report file as a run; undefined when it isn't a report of results. */
export function parseReport(file: string, text: string, brds: readonly Brd[]): ParsedReport | undefined {
  let d: Obj | undefined;
  try {
    d = obj(JSON.parse(text.replace(/^﻿/, '')));
  } catch {
    return undefined;
  }
  if (!d) return undefined;
  const project = obj(d.project);
  const run = obj(d.run);
  const list = Array.isArray(d.checks) ? d.checks : Array.isArray(d.results) ? d.results : undefined;
  if (!list?.length) return undefined;
  const base = file.split('/').pop() ?? file;
  const journey = journeyIdOf(file);
  const fileLinks = mergeLinks(inferredLinks(base, 'report file name', file));
  const results: TestResult[] = [];
  for (const raw of list.slice(0, MAX_RESULTS)) {
    const r = obj(raw);
    if (!r) continue;
    const name = str(r.name) ?? str(r.title) ?? str(r.id);
    const status = statusOf(r.verdict ?? r.status ?? r.ok ?? r.result);
    if (!name || !status) continue;
    // Declared: a requirement pointer, a covers list, a journey field. Inferred: ids in the test's name.
    const declared = [str(r.requirement), Array.isArray(r.covers) ? r.covers.filter((x) => typeof x === 'string').join(' ') : str(r.covers), str(r.journey)].filter(Boolean).join(' ');
    const links = mergeLinks(declared ? recordedLinks(declared, `${file} (declared)`, brds) : [], str(r.journey) ? [{ target: str(r.journey)!, basis: 'recorded', via: `${file} (journey field)` }] : [], inferredLinks(name, 'test name', file));
    const detail = str(r.detail) ?? (String(r.verdict ?? '').toLowerCase() === 'fault' ? 'fault: the instrument did not run' : undefined);
    results.push({ name: name.slice(0, 300), status, ...(detail ? { detail: detail.slice(0, 300) } : {}), links });
  }
  if (!results.length) return undefined;
  const declaredApp = rev(d.appRevision) ?? rev(d.testedRevision) ?? rev(project?.gitCommit) ?? rev(d.gitCommit) ?? rev(d.commit);
  const declaredTests = rev(d.testRevision) ?? rev(d.definitionRevision) ?? rev(project?.gitCommit);
  const suite = base === 'report.json' ? `toolkit report (${str(run?.trigger) ?? 'report.json'})` : journey ? `journey ${journey}` : base.replace(/\.json$/i, '');
  return {
    suite,
    ...(declaredApp ? { declaredApp } : {}),
    ...(declaredTests ? { declaredTests } : {}),
    ...(str(run?.startedAt) ? { startedAt: str(run?.startedAt) } : {}),
    ...(str(run?.finishedAt) ?? str(d.capturedAt) ? { finishedAt: str(run?.finishedAt) ?? str(d.capturedAt) } : {}),
    results,
    links: fileLinks,
  };
}

/**
 * The run of a report file at the commit that last changed it. `full` turns a declared short sha into
 * the repo's full one when it has it.
 */
export function draftFromReport(file: string, p: ParsedReport, evidence: { sha: string; at?: string }, full: (r: string) => string | undefined): TestRunDraft {
  const tested = p.declaredApp ? (full(p.declaredApp) ?? p.declaredApp) : UNKNOWN;
  const defn = p.declaredTests ? (full(p.declaredTests) ?? p.declaredTests) : UNKNOWN;
  return {
    source: 'report-file',
    // A changed file at a new commit is a new run; the same file read again is the same one.
    sourceKey: `report:${file}@${evidence.sha}`,
    suite: p.suite,
    testedRevision: tested,
    definitionRevision: defn,
    evidence: { kind: 'repo-commit', revision: evidence.sha, locator: `git:${evidence.sha}:${file}` },
    ...(p.startedAt ? { startedAt: p.startedAt } : {}),
    ...(p.finishedAt ? { finishedAt: p.finishedAt } : evidence.at ? { finishedAt: evidence.at } : {}),
    results: p.results,
    links: p.links,
    actor: { kind: 'repo', name: file },
    importer: IMPORTER_VERSION,
  };
}

/** Whether a path under REPORT_PATHS is worth reading as a report. */
export const isReportFile = (f: string) => /\.json$/i.test(f) && (f === 'docs/report.json' || f.startsWith('reports/testing/'));
