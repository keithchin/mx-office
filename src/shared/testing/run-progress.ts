// How far an office microflow test run has got, read line by line off mxcli test's own output (release 82).
// The live office's runs on a big suite all ended "Timed out after 16 min with no results" with nothing to say
// where they were: mxcli prints its results and writes the JUnit file only after it has stopped the runtime and
// restored the project, so a run stopped at the time limit had nothing, not even the tests that had passed.
// With `--verbose` (mxcli v0.27) mxcli says each phase and, while the tests run, one line per test
// ("  PASS <name> (12ms)"), so the office can show progress, say which phase a stopped run was in, and keep
// what had passed or failed by then. The phases, as mxcli v0.27 prints them:
//   Parsing test files... / Found N test(s) in M file(s)          preparing
//   Injecting test endpoint into project... / Created microflow: MxTest.Test_*   injecting (one per test)
//   Starting local runtime... / Building project (mxbuild --serve)...           building (the build, then the runtime's boot)
//   Runtime started; ...                                                         starting (the test endpoint asked)
//   Running N test(s) over the test endpoint...                                 running (verbose: a line per test)
//   Cleaning up... / project restored / Test Results ... / JUnit XML written to: <file>   cleaning, reporting
// Pure (no Node imports): the page and the CLI read its words too.

export type RunPhase = 'preparing' | 'injecting' | 'building' | 'starting' | 'running' | 'cleaning' | 'reporting';

export type LiveStatus = 'PASS' | 'FAIL' | 'ERROR' | 'SKIP';

export interface RunProgress {
  phase: RunPhase;
  /** How many tests mxcli found ("Found N test(s)"), or the office counted in the files. */
  total?: number;
  /** Test microflows created so far (one per test). */
  injected: number;
  /** Each finished test as mxcli said it live (verbose), in order. */
  results: { name: string; status: LiveStatus }[];
  /** mxcli said it wrote the JUnit file: the results are in, whatever it does after. */
  junitWritten?: boolean;
  /** When each phase began (ms), and when mxcli last said anything. */
  since: Partial<Record<RunPhase, number>>;
  lastOutput?: number;
}

export const newProgress = (now: number, total?: number): RunProgress => ({ phase: 'preparing', injected: 0, results: [], since: { preparing: now }, ...(total !== undefined ? { total } : {}) });

const ANSI = /\u001b\[[0-9;]*m/g;

/** One finished test in verbose mode: "  PASS Name of the test (12ms)" (a rollback note may follow). Not the summary's "  PASS  Name (5ms, 1 assertion)". */
const LIVE = /^\s{1,4}(PASS|FAIL|ERROR|SKIP) (\S.*) \(([0-9][0-9.]*(?:ns|µs|us|ms|s|m[0-9.]*s?|h[0-9.ms]*))\)(?:\s.*)?$/;

const to = (p: RunProgress, phase: RunPhase, now: number) => {
  if (p.phase === phase) return;
  p.phase = phase;
  p.since[phase] ??= now;
};

/** Reads one line of mxcli's output into `p` (changed in place); true when it changed what the progress says. */
export function readLine(p: RunProgress, raw: string, now: number): boolean {
  const line = raw.replace(ANSI, '').replace(/\r/g, '');
  p.lastOutput = now;
  const before = `${p.phase}|${p.total}|${p.injected}|${p.results.length}|${p.junitWritten}`;
  let m: RegExpExecArray | null;
  if ((m = /^\s*Found (\d+) test\(s\)/.exec(line))) p.total = Number(m[1]);
  else if (/^Injecting test (endpoint|runner)/.test(line)) to(p, 'injecting', now);
  else if (/^Created microflow: MxTest\.Test_/.test(line)) {
    to(p, 'injecting', now);
    p.injected++;
  } else if (/^Starting local runtime|^Building project|^Starting (the )?(app|container)/i.test(line)) to(p, 'building', now);
  else if (/^Runtime started|^App (started|is up)/i.test(line)) to(p, 'starting', now);
  else if ((m = /^Running (\d+) test\(s\)/.exec(line))) {
    to(p, 'running', now);
    p.total ??= Number(m[1]);
  } else if (/^Cleaning up\.\.\./.test(line)) to(p, 'cleaning', now);
  else if (/^Test Results\b/.test(line)) to(p, 'reporting', now);
  else if (/^JUnit XML written to:/.test(line)) {
    to(p, 'reporting', now);
    p.junitWritten = true;
  } else if (p.phase === 'running' && (m = LIVE.exec(line))) p.results.push({ name: m[2].trim(), status: m[1] as LiveStatus });
  return before !== `${p.phase}|${p.total}|${p.injected}|${p.results.length}|${p.junitWritten}`;
}

export interface LiveCounts {
  finished: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
}

export function liveCounts(p: Pick<RunProgress, 'results'>): LiveCounts {
  const c = { finished: p.results.length, passed: 0, failed: 0, errors: 0, skipped: 0 };
  for (const r of p.results) {
    if (r.status === 'PASS') c.passed++;
    else if (r.status === 'FAIL') c.failed++;
    else if (r.status === 'ERROR') c.errors++;
    else c.skipped++;
  }
  return c;
}

const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`);

/** Where the run is, in a line: "Running the tests: 40 of 123 finished (38 passed, 2 failed)". ASCII punctuation only. */
export function progressWords(p: RunProgress, now: number): string {
  const total = p.total !== undefined ? ` of ${p.total}` : '';
  const forPhase = (ph: RunPhase) => (p.since[ph] !== undefined ? ` (${mins(now - p.since[ph]!)})` : '');
  switch (p.phase) {
    case 'preparing':
      return `Getting ready${p.total !== undefined ? ` (${p.total} test${p.total === 1 ? '' : 's'})` : ''}${forPhase('preparing')}`;
    case 'injecting':
      return p.injected ? `Adding the test microflows to the app: ${p.injected}${total} added${forPhase('injecting')}` : `Checking the generated test microflows before adding them${forPhase('injecting')}`;
    case 'building':
      return `Building and starting the app${forPhase('building')}`;
    case 'starting':
      return `The app is up: starting the tests${forPhase('starting')}`;
    case 'running': {
      const c = liveCounts(p);
      const started = p.total !== undefined ? Math.min(p.total, c.finished + 1) : c.finished + 1;
      return `Running the tests: ${started}${total} started, ${c.finished} finished (${c.passed} passed, ${c.failed} failed${c.errors ? `, ${c.errors} harness error${c.errors === 1 ? '' : 's'}` : ''})${forPhase('running')}`;
    }
    case 'cleaning':
      return 'Tests done: mxcli is stopping the runtime and tidying up';
    default:
      return p.junitWritten ? 'Results written: recording them' : 'Writing the results';
  }
}

/** What the run was doing when it was stopped, for its harness error ("while the tests ran: 40 of 123 had finished"). */
export function stoppedWhile(p: RunProgress, now: number): string {
  const c = liveCounts(p);
  const total = p.total !== undefined ? ` of ${p.total}` : '';
  switch (p.phase) {
    case 'preparing':
      return 'before mxcli had started on the tests';
    case 'injecting':
      return p.injected
        ? `while mxcli was adding the test microflows to the app (${p.injected}${total} added)`
        : `while mxcli was checking the generated test microflows, before adding any (no test microflow was created in ${mins(now - (p.since.injecting ?? now))}: mxcli itself stalled there; its log is kept with the run)`;
    case 'building':
      return `while the app was building or its runtime starting (${mins(now - (p.since.building ?? now))})`;
    case 'starting':
      return `once the app was up, before the first test ran (${mins(now - (p.since.starting ?? now))})`;
    case 'running':
      return `while the tests ran: ${c.finished}${total} had finished (${c.passed} passed, ${c.failed} failed${c.errors ? `, ${c.errors} harness errors` : ''})`;
    case 'cleaning':
      return 'after the tests, while mxcli stopped the runtime and tidied up';
    default:
      return 'while mxcli was writing the results';
  }
}
