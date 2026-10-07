// Starting and stopping a test run (the Test Mode page's ▶ Run): one at a time, scripts/perf/run.mjs as
// a child process of the office, against a throwaway test office of its own under the test offices'
// folder (logic.ts resolveRoot), never the live office: refusalOf says no first when the folder isn't a
// test office's or overlaps this office's data or a floor, and the child gets none of the office's own
// AGENT_OFFICE_* settings (runEnv). Its output goes to the run's log.txt (at most LOG_MAX bytes) and its
// `@@progress` lines to the page; when it ends, its result.json makes the history's line.

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RunProgress, RunSummary, TestSuite } from '../../shared/testlab.js';
import { headlineOf, newRunId, parseProgress, refusalOf, runEnv } from './logic.js';
import { LOG_MAX, type RunStore } from './store.js';

export interface RunnerDeps {
  store: RunStore;
  /** The office's checkout, where scripts/perf/run.mjs is. */
  repoRoot: string;
  /** Where the throwaway test offices go. */
  root: string;
  dataDir: string;
  floorDirs: () => string[];
  now?: () => number;
  /** Starts the child (tests hand in their own). */
  spawn?: (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  /** Kills a child and everything it started. */
  kill?: (child: ChildProcess) => void;
  /** Told when a run starts, makes progress or ends (the routes' audit, the page). */
  onEnd?: (s: RunSummary) => void;
}

const killTree = (child: ChildProcess) => {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
  else child.kill('SIGTERM');
};

export class TestRunner {
  private child?: ChildProcess;
  private current?: RunSummary;
  private progress?: RunProgress;
  private logBytes = 0;
  private stopped = false;

  constructor(private d: RunnerDeps) {}

  get runner(): string {
    return path.join(this.d.repoRoot, 'scripts', 'perf', 'run.mjs');
  }

  /** Why a run can't start now, or undefined. */
  refusal(): string | undefined {
    return refusalOf({ root: this.d.root, dataDir: this.d.dataDir, floorDirs: this.d.floorDirs(), runner: this.runner, runnerExists: existsSync(this.runner), running: !!this.current });
  }

  running(): (RunSummary & { progress?: RunProgress }) | undefined {
    return this.current && { ...this.current, ...(this.progress ? { progress: { ...this.progress } } : {}) };
  }

  /** Starts a run of `suite`: its summary, or why it didn't start. */
  start(suite: TestSuite, by: string): RunSummary | string {
    const why = this.refusal();
    if (why) return why;
    const now = this.d.now ?? Date.now;
    const id = newRunId(now(), randomBytes(4).toString('hex'));
    const dir = this.d.store.runDir(id);
    mkdirSync(dir, { recursive: true });
    mkdirSync(this.d.root, { recursive: true });
    const s: RunSummary = { id, suite, status: 'running', startedAt: now(), by };
    this.current = s;
    this.progress = undefined;
    this.logBytes = 0;
    this.stopped = false;
    writeFileSync(this.d.store.logFile(id), '');
    this.log(id, `Test run ${id}: ${suite}, started by ${by}. Test offices under ${this.d.root}\n`);
    this.d.store.put(s);
    const args = [this.runner, '--suite', suite, '--root', this.d.root, '--out', dir, '--id', id];
    let child: ChildProcess;
    try {
      child = (this.d.spawn ?? ((c, a, o) => spawn(c, a, { ...o, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })))(process.execPath, args, { cwd: this.d.repoRoot, env: runEnv(process.env) });
    } catch (err) {
      this.finish(s, null, `Couldn't start the runner: ${(err as Error).message}`);
      return this.d.store.get(id) ?? s;
    }
    this.child = child;
    let carry = '';
    const take = (b: Buffer | string) => {
      const text = b.toString();
      this.log(id, text);
      const lines = (carry + text).split(/\r?\n/);
      carry = lines.pop() ?? '';
      if (carry.length > 4096) carry = '';
      for (const line of lines) {
        const p = parseProgress(line);
        if (p) this.progress = p;
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('error', (err) => this.finish(s, null, `The runner failed: ${err.message}`));
    child.on('close', (code) => this.finish(s, code));
    return { ...s };
  }

  /** Stops the run going (and every process it started). */
  stop(id: string): string | undefined {
    if (!this.current || this.current.id !== id || !this.child) return 'That run isn’t going';
    this.stopped = true;
    this.log(id, '\nStopped from the Test Mode page.\n');
    (this.d.kill ?? killTree)(this.child);
    return undefined;
  }

  private log(id: string, text: string) {
    if (this.logBytes >= LOG_MAX) return;
    let t = text;
    if (this.logBytes + Buffer.byteLength(t) > LOG_MAX) t = `${t.slice(0, Math.max(0, LOG_MAX - this.logBytes))}\n[log cut off at ${LOG_MAX} bytes]\n`;
    this.logBytes += Buffer.byteLength(t);
    try {
      appendFileSync(this.d.store.logFile(id), t);
    } catch {
      // A log that can't be written mustn't stop the run.
    }
  }

  private finish(s: RunSummary, code: number | null, error?: string) {
    if (this.current?.id !== s.id) return;
    const now = (this.d.now ?? Date.now)();
    const result = this.d.store.result(s.id);
    const h = error ? { status: 'error' as const, headline: error } : this.stopped && !result ? { status: 'error' as const, headline: 'Stopped from the Test Mode page' } : headlineOf(result, code);
    const done: RunSummary = { ...s, status: h.status, headline: h.headline, finishedAt: now, durationMs: now - s.startedAt };
    this.log(s.id, `\n${done.status.toUpperCase()}: ${done.headline}\n`);
    this.current = undefined;
    this.child = undefined;
    this.progress = undefined;
    this.d.store.put(done);
    this.d.onEnd?.(done);
  }
}
