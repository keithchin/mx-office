// mxcli test's JUnit, read inside an Office run envelope (Testing release 1b; docs/knowledge-evals/
// mxcli-capability-audit.md §7 and §10.2). The JUnit file alone has names, files, assertion counts and
// pass / fail / error / skip, but no revision, no time and no environment, and its list ids (test_1…)
// are positional. So a JUnit file is only ever read here as part of a run the office launched itself
// (server/testing/mxcli-test.ts), whose envelope says what was tested: never a bare file found in a repo.
//
// The mapping: <failure> is a failed test; <error> a harness error (the test never reached a verdict:
// it threw outside its assertions, or asserted nothing under --require-assertions), recorded as
// skipped with `harness` set so it counts neither as passed nor as a business failure; <skipped> is
// skipped. Exit code 1 means both "a test failed" and "the run broke", so it is never read on its own:
// the verdict comes from the JUnit content, and with no JUnit at all the run is a harness error.
// A test's id is "<repo-relative file>#<@test name>". Pure (no Node imports).

import { IMPORTER_VERSION, type RunEnvironment, type RunSubsetKept, type TestResult, type TestRunDraft } from './record.js';
import { idsIn } from './links.js';

export interface JUnitCase {
  /** "<file>#<name>": stable across runs (never test_N). */
  id: string;
  file: string;
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
  assertions?: number;
  seconds?: number;
}

export interface JUnitRun {
  suites: { name: string; tests: number; failures: number; errors: number; skipped: number; seconds?: number }[];
  cases: JUnitCase[];
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()]));

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = unescape(m[3] ?? m[4] ?? '');
  return out;
}

const num = (s: string | undefined) => (s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

/**
 * "tests/core.test.mdl" from what mxcli wrote (absolute, backslashes, ./): relative to `root` when under it
 * (the first of several that is: the work folder as named, and with its links resolved, as mxcli sees its cwd).
 */
export function relFile(file: string, root?: string | readonly (string | undefined)[]): string {
  let f = file.replace(/\\/g, '/');
  for (const one of typeof root === 'string' ? [root] : (root ?? [])) {
    if (!one) continue;
    const r = one.replace(/\\/g, '/').replace(/\/+$/, '');
    if (f.toLowerCase().startsWith(`${r.toLowerCase()}/`)) {
      f = f.slice(r.length + 1);
      break;
    }
  }
  return f.replace(/^\.\//, '');
}

/** The cases and suites in a JUnit XML text; undefined when it isn't JUnit at all. */
export function parseJUnit(xml: string, root?: string | readonly (string | undefined)[]): JUnitRun | undefined {
  if (!/<testsuites?\b/.test(xml)) return undefined;
  const run: JUnitRun = { suites: [], cases: [] };
  for (const m of xml.matchAll(/<testsuite\b([^>]*)>/g)) {
    const a = attrs(m[1]);
    run.suites.push({ name: a.name ?? '', tests: num(a.tests) ?? 0, failures: num(a.failures) ?? 0, errors: num(a.errors) ?? 0, skipped: num(a.skipped) ?? 0, ...(num(a.time) !== undefined ? { seconds: num(a.time) } : {}) });
  }
  // Each <testcase …/> or <testcase …>…</testcase>.
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attrs(m[1]);
    const body = m[3] ?? '';
    const name = a.name ?? '';
    const file = relFile(a.file || (a.classname ? `${a.classname.replace(/\./g, '/')}` : ''), root);
    const fail = /<failure\b([^>]*?)(?:\/>|>([\s\S]*?)<\/failure>)/.exec(body);
    const err = /<error\b([^>]*?)(?:\/>|>([\s\S]*?)<\/error>)/.exec(body);
    const skip = /<skipped\b([^>]*?)\/?>/.exec(body);
    const prop = /<property\b[^>]*name\s*=\s*["']assertions["'][^>]*>/.exec(body);
    const hit = err ?? fail;
    const message = hit ? (attrs(hit[1]).message || unescape((hit[2] ?? '').trim())).slice(0, 2000) : skip ? attrs(skip[1]).message : undefined;
    run.cases.push({
      id: `${file || 'unknown-file'}#${name}`,
      file,
      name,
      // An <error> wins over a <failure> in the same case: the harness broke, so its verdict can't be trusted.
      status: err ? 'error' : fail ? 'failed' : skip ? 'skipped' : 'passed',
      ...(message ? { message } : {}),
      ...(prop && num(attrs(prop[0]).value) !== undefined ? { assertions: num(attrs(prop[0]).value) } : {}),
      ...(num(a.time) !== undefined ? { seconds: num(a.time) } : {}),
    });
  }
  return run;
}

/** A case as a record's result: error → skipped + harness, never failed or passed. */
export function resultOf(c: JUnitCase): TestResult {
  // An id in a test's name is inferred, as release 1 reads names (only a file's own declaration is recorded).
  const links = idsIn(c.name).map((target) => ({ target, basis: 'inferred' as const, via: `@test name in ${c.file}`, rule: 'UC / BR / AC id in the @test name' }));
  const base = { name: c.id, links, ...(c.assertions !== undefined ? { assertions: c.assertions } : {}) };
  if (c.status === 'error') return { ...base, status: 'skipped', harness: true, detail: `harness error${c.message ? `: ${c.message}` : ''}` };
  return { ...base, status: c.status, ...(c.message ? { detail: c.message } : {}) };
}

/** What the office knew about a run it launched (its envelope), apart from the JUnit. */
export interface MxcliRunEnvelope {
  runId: string;
  floor: string;
  /** The work folder's commit: the tested app revision and the test-definition revision both. */
  commit: string;
  branch?: string;
  /** The test paths given to mxcli, relative to the work folder. */
  paths: string[];
  environment: RunEnvironment;
  /** The work folder with its links resolved, as mxcli sees its cwd (on macOS /var/… is /private/var/…); not kept in the record. */
  workFolderReal?: string;
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  /** Where the JUnit file is kept in the office's data folder (undefined: mxcli wrote none). */
  junitLocator?: string;
  /** Why the run could not complete, when the office knows (could not start, timed out). */
  failure?: string;
  /** mxcli's last words, for a harness error. */
  tail?: string;
  actor: string;
  /** Only some test files ran (office-app test --files / --tag): what was asked and the files it picked. */
  subset?: RunSubsetKept;
  /** The run's time limit, and whether it was sized to the suite. */
  limit?: { minutes: number; auto: boolean };
  /** Where mxcli's whole output (masked) is kept in the office's data folder. */
  logLocator?: string;
  /** No JUnit file: what mxcli said live for each test, and the tests it never got to (shared/testing/test-files.ts partialResults). */
  partial?: TestResult[];
}

export const MXCLI_TEST_SUITE = 'microflow tests (mxcli test)';

/**
 * The record for a run the office launched: both revisions are the work folder's commit, the evidence is
 * the JUnit file in the office's store. No JUnit (or JUnit with no case) is a harness error, never failed
 * tests, whatever the exit code said.
 */
export function draftFromMxcliRun(env: MxcliRunEnvelope, junit: string | undefined): TestRunDraft {
  const parsed = junit !== undefined ? parseJUnit(junit, [env.environment.workFolder, env.workFolderReal]) : undefined;
  const results = parsed?.cases.map(resultOf) ?? (junit === undefined ? (env.partial ?? []) : []);
  let harnessError: string | undefined;
  if (env.failure) harnessError = env.failure;
  else if (junit === undefined) harnessError = `mxcli wrote no JUnit file (exit ${env.exitCode ?? 'none'})${env.tail ? `: ${env.tail}` : ''}`;
  else if (!parsed) harnessError = 'The JUnit file mxcli wrote could not be read';
  else if (!results.length) harnessError = `The JUnit file has no test cases (exit ${env.exitCode ?? 'none'})${env.tail ? `: ${env.tail}` : ''}`;
  return {
    source: 'mxcli-test',
    sourceKey: `mxcli-test:${env.floor}:${env.runId}`,
    suite: MXCLI_TEST_SUITE,
    testedRevision: env.commit,
    definitionRevision: env.commit,
    evidence: { kind: 'office', revision: env.runId, locator: env.junitLocator ? `office:${env.junitLocator}` : `office:mxcli-test/${env.runId} (no JUnit file)` },
    ...(env.branch ? { branch: env.branch } : {}),
    startedAt: env.startedAt,
    finishedAt: env.finishedAt,
    results,
    links: [],
    actor: { kind: 'office', name: env.actor },
    environment: env.environment,
    exitCode: env.exitCode,
    ...(env.subset ? { subset: env.subset } : {}),
    ...(env.limit ? { limit: env.limit } : {}),
    ...(env.logLocator ? { log: `office:${env.logLocator}` } : {}),
    ...(harnessError ? { harnessError: harnessError.slice(0, 600) } : {}),
    importer: `${IMPORTER_VERSION}+junit/1`,
  };
}
