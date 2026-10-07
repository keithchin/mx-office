// The performance guard's results, as the harnesses in scripts/perf/ write them (one JSON file per run)
// and the Test Mode page (/lite?tab=tests) reads them. Types and pure constants only: the harnesses are
// plain .mjs, so this file is their contract, not their import.

/** The suites the Test Mode page can show and start. */
export const TEST_SUITES = ['unit', 'pages', 'journey', 'command-center'] as const;
export type TestSuite = (typeof TEST_SUITES)[number];

export const SUITE_LABEL: Record<TestSuite, string> = {
  unit: 'Unit tests',
  pages: 'Page responsiveness',
  journey: 'End-to-end journey',
  'command-center': 'Command Center check',
};

/**
 * The page budgets (scripts/perf/budgets.mjs mirrors these; tests/perf-budgets.test.ts keeps the two the
 * same). Tune them here.
 */
export const PERF_BUDGETS = {
  /** No single main-thread task may run longer than this while a view opens or runs. */
  longTaskMs: 200,
  /** From navigation until the view has drawn its main content and answers. */
  timeToUsableMs: 3000,
  /** From picking another project (the floor picker, or a card on Home) until its view is usable. */
  switchMs: 1500,
  /** How long each view is left running on live events while its heap is watched. */
  soakSeconds: 60,
  /** The JS heap may grow by at most this much over the soak (after a GC at each end). */
  heapGrowthPct: 25,
  /** Growth below this many MB never fails, whatever the percentage (small heaps jitter). */
  heapSlackMB: 4,
} as const;

/** One long main-thread task seen on a view. */
export interface LongTask {
  ms: number;
  /** When it started, ms after navigation. */
  at: number;
  /** The top frames of the CPU profile samples taken during it, when the profiler caught any. */
  stack?: string[];
}

/** What a view measured, and why it failed if it did. */
export interface ViewResult {
  id: string;
  name: string;
  path: string;
  ok: boolean;
  /** Milliseconds from navigation until the view was usable (its ready selector drawn and the page answering). */
  ttuMs: number | null;
  longestTaskMs: number;
  longTasks: LongTask[];
  heapStartMB: number | null;
  heapEndMB: number | null;
  heapGrowthPct: number | null;
  domNodes: number | null;
  failures: string[];
  /** The screenshot's file name, next to the result JSON, when one was taken. */
  screenshot?: string;
  /** Errors the page threw while it was open. */
  pageErrors?: string[];
  /** Where the time went in its long tasks, from a second opening under the CPU profiler (a failure only). */
  profiled?: LongTask[];
  /** A view that failed on time alone is opened once more (a busy machine): what the first try measured. */
  firstTry?: { longestTaskMs: number; ttuMs: number | null; failures: string[] };
}

/** A journey step (suite 'journey'). */
export interface StepResult {
  id: string;
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  screenshot?: string;
}

/** One run of one suite: what scripts/perf/run.mjs writes as <data>/testlab/runs/<id>.json. */
export interface RunResult {
  id: string;
  suite: TestSuite;
  ok: boolean;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  /** The budgets the run was held to. */
  budgets?: Record<string, number>;
  /** Pages: one row per view. */
  views?: ViewResult[];
  /** Journey: one row per step. */
  steps?: StepResult[];
  /** Unit tests and the Command Center check: counts and the failing test names. */
  counts?: { pass: number; fail: number; skip?: number };
  failures?: string[];
  /** Where the throwaway test office lived. */
  officeDir?: string;
  /** Why the run couldn't run at all (refused, crashed). */
  error?: string;
}

/** What the Test Mode page lists for a run (the history keeps at most RUN_HISTORY of these). */
export interface RunSummary {
  id: string;
  suite: TestSuite;
  status: 'running' | 'pass' | 'fail' | 'error';
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  /** One line: "13/14 views within budget", "7/7 steps", "1023 pass, 2 fail". */
  headline?: string;
  /** Who started it. */
  by?: string;
  /** Incidents opened from this run's failures: what failed (a view or step id, or 'run') to the incident's number. */
  incidents?: Record<string, number>;
}

/** A run's progress while it goes, from the runner's `@@progress {...}` lines. */
export interface RunProgress {
  done: number;
  of: number;
  label?: string;
}

/** GET /api/testlab: what the Test Mode page draws. */
export interface TestLabView {
  testMode: { on: boolean; why?: string };
  /** Where the throwaway test offices go, and why a run can't start (when it can't). */
  root?: string;
  refusal?: string;
  suites: { suite: TestSuite; last?: RunSummary }[];
  history: RunSummary[];
  running?: RunSummary & { progress?: RunProgress };
}

export const RUN_HISTORY = 50;

/** The Test Mode page's address: the 1D view's tests tab (`/lite?tab=tests`), on `floor` when given (the 1D view needs one to open). Never the 3D office. */
export function testsHref(floor?: string, run?: string): string {
  const q = new URLSearchParams();
  if (floor) q.set('floor', floor);
  q.set('tab', 'tests');
  if (run) q.set('run', run);
  return `/lite?${q.toString()}`;
}
