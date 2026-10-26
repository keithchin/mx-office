// A test-run record (Testing release 1, docs/site/insights/testing.md): one run of one suite, bound to
// three revisions kept apart on purpose. The tested app revision is the commit the app under test was
// built from, the test-definition revision the commit the tests were taken from, and the evidence
// revision where the report itself is kept (a repo commit, a CI run, the office's own store). A report
// committed at B proves nothing about B: unless it declares what it tested, its tested revision is
// 'unknown' and it counts as evidence for no commit. Pure (no Node imports): the page reads it too.

/** A full or short commit sha, or 'unknown' when the source didn't say. */
export type Revision = string;
export const UNKNOWN = 'unknown';

/** office-journey: a journey or smoke run an agent asked the office for, on its app instance at a commit (server/agent-app/). */
export type RunSource = 'pr-checks' | 'report-file' | 'gate-check' | 'mxcli-test' | 'office-journey';

export type ResultStatus = 'passed' | 'failed' | 'skipped';

/**
 * Why a test is tied to a use case, rule or criterion. `recorded`: a file or a source said so (the
 * acceptance-criteria table, a journey naming UC001, a report's requirement field). `inferred`: worked
 * out by a rule (an id in a test's name or a PR title), and the rule is kept with it.
 */
export interface Link {
  /** UC001, BR012, AC-04, or a journey id (J-01). */
  target: string;
  basis: 'recorded' | 'inferred';
  /** Where it came from, in words: "architecture/acceptance-criteria.md (AC → journey)". */
  via: string;
  /** For an inferred link, the rule that matched ("BR id in the PR title"). */
  rule?: string;
}

export interface TestResult {
  name: string;
  /**
   * 'skipped' for a harness error too (`harness` set): the test never reached a verdict, so it counts
   * neither as passed nor as a business failure, and a required check it decides is never met.
   */
  status: ResultStatus;
  detail?: string;
  /** The harness broke on this test (JUnit <error>: it threw outside its assertions, or asserted nothing under --require-assertions). Its status is 'skipped'. */
  harness?: true;
  /** How many assertions it checked (mxcli test's JUnit property). */
  assertions?: number;
  /** The ids the source tied this test to (declared links, and inferred ones with their rule). */
  links: Link[];
}

export interface Evidence {
  /** A repo commit (the commit that added or changed the report), a CI run, or the office's own store. */
  kind: 'repo-commit' | 'ci-run' | 'office';
  revision: Revision;
  /** Where to look: "git:<sha>:reports/testing/x.json", a run's URL, "office:gate-check". */
  locator: string;
}

export interface TestRunRecord {
  schemaVersion: 1;
  /** tr_<ulid>, minted when the office first ingested it. */
  id: string;
  source: RunSource;
  /** What makes two readings of the same run the same: ingesting a key twice keeps one record. */
  sourceKey: string;
  suite: string;
  testedRevision: Revision;
  definitionRevision: Revision;
  evidence: Evidence;
  branch?: string;
  pr?: number;
  /** ISO times, when the source gave them. */
  startedAt?: string;
  finishedAt?: string;
  results: TestResult[];
  /** The run's own overall conclusion, when the source gave one apart from its results (a CI run's). Release 2; optional. */
  conclusion?: ResultStatus;
  /** Links the whole run carries (a PR title naming BR012), beside each result's own. */
  links: Link[];
  actor: { kind: 'ci' | 'office' | 'repo'; name: string };
  /** What ran it, for a run the office launched itself (mxcli-test): the build and runtime identity. */
  environment?: RunEnvironment;
  /** The launched program's exit code (null: it never started, or was stopped). Never a verdict on its own. */
  exitCode?: number | null;
  /** The whole run could not complete (no runtime, no JUnit written, a timeout): a harness error, never failed tests. */
  harnessError?: string;
  importer: string;
  /** When the office ingested it (ms). */
  ingestedAt: number;
}

export interface RunEnvironment {
  runner: string;
  mxcliVersion: string;
  /** How the app under test ran: mxcli's local runtime, a Docker container, or an app already up. */
  runtime: 'local' | 'docker' | 'attach';
  /** The Mendix version the model says (mxcli's "Connected to: … (Mendix x.y.z)"), when it said. */
  mendixVersion?: string;
  /** Where it ran: the office's own work folder (never a floor checkout or an agent's worktree). */
  workFolder: string;
}

/** What an importer hands the store: everything but the id and the time it was taken in. */
export type TestRunDraft = Omit<TestRunRecord, 'id' | 'ingestedAt' | 'schemaVersion'>;

export const IMPORTER_VERSION = 'testing-import/1';

export const isKnown = (r: Revision | undefined): r is string => !!r && r !== UNKNOWN;

/** Whether two revisions name the same commit (a declared short sha against a full one). */
export function sameRevision(a: Revision | undefined, b: Revision | undefined): boolean {
  if (!isKnown(a) || !isKnown(b)) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const n = Math.min(x.length, y.length);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

/** "3f2a9c1" for a sha, "unknown" as it is. */
export const shortRev = (r: Revision | undefined) => (isKnown(r) ? (/^[0-9a-f]{12,}$/i.test(r) ? r.slice(0, 7) : r) : UNKNOWN);

/** pass / ok / ✅ … in the words reports use, as a result status; undefined when it doesn't read as one. */
export function statusOf(v: unknown): ResultStatus | undefined {
  if (v === true) return 'passed';
  if (v === false) return 'failed';
  const s = String(v ?? '')
    .trim()
    .toLowerCase();
  if (!s) return undefined;
  if (/^(pass|passed|ok|success|succeeded|green|✅|✔)/u.test(s)) return 'passed';
  if (/^(fail|failed|failure|error|red|broken|❌|✖|✗)/u.test(s)) return 'failed';
  if (/^(skip|skipped|fault|manual|pending|waived|neutral|n\/a|not run|⏭|⚠|➖)/u.test(s)) return 'skipped';
  return undefined;
}
