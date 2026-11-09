// The background checks' run machinery, per Expert project (shared/expert-checks.ts; the steps themselves are
// ./steps.ts, the office's wiring ./index.ts). Keith's rule (design notes, answer 2): tests run when the session goes
// idle, not after every change. So:
//   * trigger: the session settled after a change (expert/service.ts made or saw its commit, the session idle), then
//     a short debounce (IDLE_CHECK_DEBOUNCE_MS). A commit already checked isn't checked again;
//   * never while the session works: a turn starting cancels the debounce, and a background run under way stops at
//     the next safe point (journeys at once: their scripts are ended; an mxcli microflow test run can't be stopped
//     safely, so it finishes and nothing after it starts) and runs again on the next idle;
//   * exactly one run per project at a time: background runs never queue up (a trigger during a run asks for one
//     more once it ends), and runChecks (Lock in) waits for the run under way, then runs;
//   * the preview first: before each step, while the in-place preview builds or reloads, the run waits (up to
//     PREVIEW_WAIT_MS), so a check never competes with the reload the user is waiting for.
// Pure apart from its deps: the clock, timers and every outside effect come in.

import { IDLE_KINDS, type CheckCounts, type CheckFailure, type CheckKind, type CheckScope, type ProofLint, type ProofTests } from '../../shared/expert-checks.js';
import type { LintDelta } from './lint-delta.js';
import type { Selection } from './select.js';

/** The LINT cell while the first lint run makes the office's copy of the app. */
export const FIRST_LINT = 'first lint run, may take a few minutes';
/** The run waits this long after the session settles (a new turn meanwhile cancels it). */
export const IDLE_CHECK_DEBOUNCE_MS = 8_000;
/** How long a step waits for the preview to finish building or reloading before it goes ahead. */
export const PREVIEW_WAIT_MS = 3 * 60_000;
const POLL_MS = 1_000;

export interface StepIn {
  floorId: string;
  dir: string;
  commit: string;
  scope: CheckScope;
  selection: Selection;
  /** Aborted when the run is cancelled: a step that can stop safely stops. */
  signal: AbortSignal;
  /** What runs right now, for the strip ("journey J04b"). */
  now(words: string): void;
}

export interface TestsOut {
  counts: CheckCounts;
  failures: CheckFailure[];
  notes: string[];
  /** The testing ledger's record ids it wrote. */
  records: string[];
}

export interface LintOut {
  delta?: LintDelta;
  /** Why it didn't run (no mxcli, no .mpr…): the cell says so. */
  skipped?: string;
  records: string[];
}

export interface MxCheckOut {
  status: 'pass' | 'fail' | 'error';
  errors?: number;
  warnings?: number;
  why?: string;
}

export interface ChecksDeps {
  /** The project folder's HEAD commit. */
  head(dir: string): Promise<string | undefined>;
  select(dir: string, to: string, o: { from?: string; scope: CheckScope; scripts?: string[] }): Promise<Selection>;
  microflow(i: StepIn): Promise<TestsOut>;
  journeys(i: StepIn): Promise<TestsOut>;
  lint(i: StepIn): Promise<LintOut>;
  mxcheck?(i: StepIn): Promise<MxCheckOut>;
  /** Whether the project's preview is building or reloading right now. */
  previewBusy(floorId: string): boolean;
  /** The MDL scripts the session ran since they were last taken (the hooks' exec.sh calls), taken. */
  takeScripts?(floorId: string): string[];
  /** No lint copy of the app yet: the first lint run makes one, which takes a few minutes on a grown app. */
  lintFirst?(floorId: string): boolean;
  /** The proof changed: pages look again. */
  changed(floorId: string): void;
  now(): number;
  debounceMs?: number;
  previewWaitMs?: number;
  pollMs?: number;
}

/** What a run did: Lock in reads this (and the testing ledger, where every result is recorded at `commit`). */
export interface ChecksResult {
  commit: string;
  scope: CheckScope;
  kinds: CheckKind[];
  startedAt: number;
  endedAt: number;
  /** Stopped before the end (the session started working again). */
  cancelled: boolean;
  /** Why nothing ran (no commit yet). */
  why?: string;
  selection?: Selection;
  tests: ProofTests | null;
  lint: ProofLint | null;
  mxcheck?: MxCheckOut;
  /** Every testing ledger record the run wrote. */
  records: string[];
}

export interface RunOpts {
  scope?: CheckScope;
  kinds?: readonly CheckKind[];
}

interface Running {
  commit: string;
  background: boolean;
  abort: AbortController;
  done: Promise<ChecksResult>;
}

interface FloorChecks {
  id: string;
  dir: string;
  busy: boolean;
  timer?: NodeJS.Timeout;
  running?: Running;
  /** Every run, one after another (runChecks waits its turn here). */
  chain: Promise<unknown>;
  /** A trigger came during a run (or a run was cancelled): once more on the next idle. */
  again: boolean;
  /** The last commit a background run finished on (not cancelled). */
  checked?: string;
  tests: ProofTests | null;
  lint: ProofLint | null;
}

const zero = (): CheckCounts => ({ passed: 0, failed: 0, notRun: 0, total: 0 });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.());

export class BackgroundChecks {
  private floors = new Map<string, FloorChecks>();
  private stopped = false;

  constructor(readonly d: ChecksDeps) {}

  private of(id: string, dir: string): FloorChecks {
    let s = this.floors.get(id);
    if (!s || s.dir !== dir) {
      if (s) clearTimeout(s.timer);
      s = { id, dir, busy: false, chain: Promise.resolve(), again: false, tests: null, lint: null };
      this.floors.set(id, s);
    }
    return s;
  }

  /** The session started (true) or ended (false) a turn. A turn starting cancels the debounce and stops a background run. */
  busy(id: string, dir: string, on: boolean) {
    const s = this.of(id, dir);
    if (s.busy === on) return;
    s.busy = on;
    // Idle again after a run was stopped (or asked for during one): once more, even with nothing new committed.
    if (!on) return void (s.again && this.settled(id, dir));
    clearTimeout(s.timer);
    s.timer = undefined;
    if (s.running?.background && !s.running.abort.signal.aborted) {
      s.again = true;
      s.running.abort.abort('the session started working again');
    }
  }

  /** The session settled after a change (its commit made or seen, the session idle): a run after the debounce. */
  settled(id: string, dir: string) {
    const s = this.of(id, dir);
    if (s.busy || this.stopped) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      s.timer = undefined;
      void this.kick(id);
    }, this.d.debounceMs ?? IDLE_CHECK_DEBOUNCE_MS);
    s.timer.unref?.();
  }

  /** The debounce ran out: a background run, unless the session works, a run is under way, or the commit was checked. */
  async kick(id: string): Promise<ChecksResult | undefined> {
    const s = this.floors.get(id);
    if (!s || this.stopped || s.busy) return undefined;
    if (s.running) {
      s.again = true;
      return undefined;
    }
    const head = await this.d.head(s.dir);
    if (!head || s.busy || s.running) return undefined;
    if (head === s.checked && !s.again) return undefined;
    s.again = false;
    return this.enqueue(s, { scope: 'affected', kinds: IDLE_KINDS }, true);
  }

  /** Runs checks now (Lock in): after the run under way, if any; never cancelled by the session's turns. */
  runChecks(id: string, dir: string, o: RunOpts = {}): Promise<ChecksResult> {
    return this.enqueue(this.of(id, dir), { scope: o.scope ?? 'affected', kinds: o.kinds?.length ? o.kinds : IDLE_KINDS }, false);
  }

  private enqueue(s: FloorChecks, o: Required<RunOpts>, background: boolean): Promise<ChecksResult> {
    const p = s.chain.then(() => this.execute(s, o, background));
    s.chain = p.catch(() => undefined);
    return p;
  }

  /** Waits while the preview builds or reloads (up to the limit), or until the run is stopped. */
  private async previewSettled(s: FloorChecks, signal: AbortSignal) {
    const until = this.d.now() + (this.d.previewWaitMs ?? PREVIEW_WAIT_MS);
    while (!signal.aborted && this.d.previewBusy(s.id) && this.d.now() < until) await sleep(this.d.pollMs ?? POLL_MS);
  }

  private async execute(s: FloorChecks, o: Required<RunOpts>, background: boolean): Promise<ChecksResult> {
    const startedAt = this.d.now();
    const kinds = [...new Set(o.kinds)];
    const commit = await this.d.head(s.dir);
    const empty = { scope: o.scope, kinds, startedAt, cancelled: false, tests: s.tests, lint: s.lint, records: [] as string[] };
    if (!commit) return { ...empty, commit: '', endedAt: this.d.now(), why: 'No commit yet' };
    // Never while the session works (it may have started again while the run waited its turn).
    if (background && s.busy) {
      s.again = true;
      return { ...empty, commit, endedAt: this.d.now(), cancelled: true };
    }
    const abort = new AbortController();
    let resolveDone!: (r: ChecksResult) => void;
    const running: Running = { commit, background, abort, done: new Promise((r) => (resolveDone = r)) };
    s.running = running;
    const records: string[] = [];
    const doTests = kinds.includes('tests') || kinds.includes('journeys');
    let result: ChecksResult | undefined;
    try {
      const scripts = this.d.takeScripts?.(s.id) ?? [];
      const selection = await this.d.select(s.dir, commit, { scope: o.scope, ...(s.checked && o.scope === 'affected' ? { from: s.checked } : {}), scripts });
      const notes = [`${o.scope === 'all' ? 'Everything' : 'Affected set'}: ${selection.how}`, ...selection.notes];
      if (doTests) s.tests = { state: 'running', commit, startedAt, scope: o.scope, journeys: zero(), microflow: zero(), failures: [], notes };
      if (kinds.includes('lint')) s.lint = { state: 'running', commit, startedAt, errors: 0, warnings: 0, findings: [], baseline: false, ...(this.d.lintFirst?.(s.id) ? { note: FIRST_LINT } : {}) };
      this.d.changed(s.id);
      const step: StepIn = {
        floorId: s.id,
        dir: s.dir,
        commit,
        scope: o.scope,
        selection,
        signal: abort.signal,
        now: (w) => {
          if (s.tests?.state === 'running') s.tests = { ...s.tests, now: w };
          this.d.changed(s.id);
        },
      };
      let mxcheck: MxCheckOut | undefined;
      const stopped = () => abort.signal.aborted;

      if (kinds.includes('lint') && !stopped()) {
        await this.previewSettled(s, abort.signal);
        if (!stopped()) {
          const l = await this.d.lint(step).catch((err: Error): LintOut => ({ skipped: `Lint didn't run: ${err.message}`, records: [] }));
          records.push(...l.records);
          s.lint = l.delta
            ? { state: 'done', commit, startedAt, endedAt: this.d.now(), errors: l.delta.errors, warnings: l.delta.warnings, findings: l.delta.findings, baseline: l.delta.baseline, ...(l.delta.baseline ? {} : { note: 'No lint baseline: counts of everything, not only new findings' }) }
            : { state: 'skipped', commit, startedAt, endedAt: this.d.now(), errors: 0, warnings: 0, findings: [], baseline: false, note: l.skipped ?? 'not run' };
          this.d.changed(s.id);
        }
      }
      const failures: CheckFailure[] = [];
      const testNotes = [...notes];
      let journeys = zero();
      let microflow = zero();
      if (kinds.includes('journeys') && !stopped()) {
        await this.previewSettled(s, abort.signal);
        if (!stopped() && selection.journeys.length) {
          const j = await this.d.journeys(step).catch((err: Error): TestsOut => ({ counts: { ...zero(), notRun: selection.journeys.length, total: selection.journeys.length }, failures: [], notes: [`Journeys didn't run: ${err.message}`], records: [] }));
          journeys = j.counts;
          failures.push(...j.failures);
          testNotes.push(...j.notes);
          records.push(...j.records);
          if (s.tests) s.tests = { ...s.tests, journeys, failures: [...failures] };
          this.d.changed(s.id);
        }
      }
      if (kinds.includes('tests') && !stopped()) {
        await this.previewSettled(s, abort.signal);
        // From here the run can't be stopped safely (mxcli test): it finishes even when the session starts again.
        if (!stopped() && selection.tests.length) {
          step.now(`${selection.tests.length} microflow test file${selection.tests.length === 1 ? '' : 's'}`);
          const t = await this.d.microflow(step).catch((err: Error): TestsOut => ({ counts: { ...zero(), notRun: selection.tests.length, total: selection.tests.length }, failures: [], notes: [`Microflow tests didn't run: ${err.message}`], records: [] }));
          microflow = t.counts;
          failures.push(...t.failures);
          testNotes.push(...t.notes);
          records.push(...t.records);
        }
      }
      if (kinds.includes('mxcheck') && this.d.mxcheck && !stopped()) {
        await this.previewSettled(s, abort.signal);
        if (!stopped()) mxcheck = await this.d.mxcheck(step).catch((err: Error): MxCheckOut => ({ status: 'error', why: err.message }));
      }
      const cancelled = stopped();
      const endedAt = this.d.now();
      if (cancelled) testNotes.push(`Stopped: ${typeof abort.signal.reason === 'string' ? abort.signal.reason : 'cancelled'}. It runs again when the session is idle.`);
      if (doTests) s.tests = { state: cancelled ? 'cancelled' : 'done', commit, startedAt, endedAt, scope: o.scope, journeys, microflow, failures, notes: [...new Set(testNotes)] };
      if (kinds.includes('lint') && s.lint?.state === 'running') s.lint = { ...s.lint, state: 'cancelled', endedAt, note: 'Stopped: the session started working again' };
      // A commit counts as checked once everything the idle run does ran on it (a lint-only ask doesn't).
      if (!cancelled && IDLE_KINDS.every((k) => kinds.includes(k))) s.checked = commit;
      result = { commit, scope: o.scope, kinds, startedAt, endedAt, cancelled, selection, tests: s.tests, lint: s.lint, ...(mxcheck ? { mxcheck } : {}), records };
      return result;
    } finally {
      if (!result) {
        // A step threw past its own catch (select, say): the cells say so instead of spinning.
        const endedAt = this.d.now();
        if (s.tests?.state === 'running') s.tests = { ...s.tests, state: 'skipped', endedAt, notes: ['The run couldn’t start; it tries again on the next idle'] };
        if (s.lint?.state === 'running') s.lint = { ...s.lint, state: 'skipped', endedAt, note: 'The run couldn’t start' };
        result = { commit, scope: o.scope, kinds, startedAt, endedAt, cancelled: true, tests: s.tests, lint: s.lint, records };
      }
      resolveDone(result);
      if (s.running === running) s.running = undefined;
      this.d.changed(s.id);
      if (s.again && !s.busy && !this.stopped) this.settled(s.id, s.dir);
    }
  }

  /** The strip's cells; nulls until a run started. */
  proof(id: string): { tests: ProofTests | null; lint: ProofLint | null } {
    const s = this.floors.get(id);
    return { tests: s?.tests ?? null, lint: s?.lint ?? null };
  }

  /** The run under way, if any (its commit, and whether it's a background one). */
  runningOn(id: string): { commit: string; background: boolean; done: Promise<ChecksResult> } | undefined {
    const r = this.floors.get(id)?.running;
    return r && { commit: r.commit, background: r.background, done: r.done };
  }

  forget(id: string) {
    const s = this.floors.get(id);
    if (s) {
      clearTimeout(s.timer);
      s.running?.abort.abort('the project was removed');
    }
    this.floors.delete(id);
  }

  stop() {
    this.stopped = true;
    for (const s of this.floors.values()) {
      clearTimeout(s.timer);
      s.running?.abort.abort('the office is stopping');
    }
  }
}
