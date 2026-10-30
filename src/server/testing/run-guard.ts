// One office test run per work folder, and no run left holding it (release 81). The live office's microflow run
// failed with git's "unable to unlink old 'App.mpr': Invalid argument": an earlier run's mxcli had been stopped by
// its timeout three hours before, but the mxbuild and runtime it started lived on and kept App.mpr open, and
// execFile's timeout only ever stops the program it started, never its children. So:
//   - runs that use the same work folder (a project's tests, its quality) go one at a time (oneAtATime);
//   - the office's own mxcli is started here (runMxOwned), its pid and start written beside the work folder
//     (<dir>.owner.json); at its timeout, and once it ends, whatever it started that is still running (its
//     process tree: children by parent id, started after it) is stopped;
//   - before a folder is used again, a run recorded there that is past its time is stopped the same way (an
//     office restart lost the timer), and one still within its time is said in plain words, not git's;
//   - release 82: the run answers when mxcli itself ends (not when the last holder of its output does), and soon
//     after its results are in; at the time limit the root goes first, then its tree (stopTree);
//   - only processes the office recorded as its own are ever stopped: the recorded pid (when its start time
//     matches) and processes started after it whose parent chain leads to it.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { execFileOffP, spawnOff } from '../offloop/exec.js';
import type { MxOut } from './mxcli-run.js';

/** One process as the machine lists it: its id, its parent's, and when it started (ms). */
export interface Proc {
  pid: number;
  ppid: number;
  start: number;
}

export interface GuardDeps {
  /** Every process now (the machine's list by default). */
  list?(): Promise<Proc[]>;
  /** Stops one process (forcefully). */
  kill?(pid: number): Promise<void>;
  now?(): number;
}

/** What a run wrote beside its work folder. */
export interface Owner {
  pid: number;
  startedAt: number;
  /** When its time runs out (its timeout from the start). */
  deadline: number;
  program: string;
}

const WIN = process.platform === 'win32';
const ownerFile = (dir: string) => `${dir}.owner.json`;

/** The machine's processes: PowerShell's Win32_Process on Windows, ps elsewhere. Off the event loop; [] when it can't tell. */
export async function listProcs(now = Date.now()): Promise<Proc[]> {
  try {
    if (WIN) {
      const cmd = "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() }";
      const { stdout } = await execFileOffP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
      return parseProcs(stdout, (n) => n);
    }
    const { stdout } = await execFileOffP('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'etimes='], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    return parseProcs(stdout, (secs) => now - secs * 1000);
  } catch {
    return [];
  }
}

/** "pid ppid time" lines; `when` turns the third number into a start time (ms). */
export function parseProcs(text: string, when: (n: number) => number): Proc[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((p) => p.length >= 3 && p.every(Number.isFinite) && p[0] > 0)
    .map(([pid, ppid, t]) => ({ pid, ppid, start: when(t) }));
}

async function killPid(pid: number): Promise<void> {
  try {
    if (WIN) await execFileOffP('taskkill.exe', ['/F', '/PID', String(pid)], { timeout: 15_000, windowsHide: true });
    else process.kill(pid, 'SIGKILL');
  } catch {
    // gone already
  }
}

/**
 * The process tree a run recorded: the root when it is still the same process (started within a few seconds
 * of the record), and every process started after it whose parent chain leads to it, even once the root is gone
 * (an orphaned mxbuild still names the mxcli that started it as its parent).
 */
export function treeOf(procs: readonly Proc[], o: Pick<Owner, 'pid' | 'startedAt'>): number[] {
  const out: number[] = [];
  const root = procs.find((p) => p.pid === o.pid);
  if (root && Math.abs(root.start - o.startedAt) <= 10_000) out.push(root.pid);
  const ids = new Set([o.pid]);
  // Parents before children by start time, so one pass follows each chain down.
  for (const p of [...procs].sort((a, b) => a.start - b.start)) {
    if (p.pid === o.pid || p.start < o.startedAt - 1_000) continue;
    if (ids.has(p.ppid)) {
      ids.add(p.pid);
      out.push(p.pid);
    }
  }
  return out;
}

/**
 * Stops a recorded run's tree; the pids it stopped. The root goes first (release 82): stopped children-first, a
 * mxcli whose child was killed under it went on to its own clean-up (printing "Cleaning up..." as its last words,
 * which read as a hang there) and started new children nobody had listed. Then everything it had started, and a
 * second look for whatever it started meanwhile.
 */
export async function stopTree(o: Pick<Owner, 'pid' | 'startedAt'>, d: GuardDeps = {}): Promise<number[]> {
  const kill = d.kill ?? killPid;
  const tree = treeOf(await (d.list ?? listProcs)(), o);
  if (!tree.length) return [];
  const rootFirst = tree[0] === o.pid;
  if (rootFirst) await kill(o.pid);
  for (const pid of tree.slice(rootFirst ? 1 : 0).reverse()) await kill(pid);
  const late = treeOf(await (d.list ?? listProcs)(), o).filter((p) => !tree.includes(p));
  for (const pid of late.reverse()) await kill(pid);
  return [...tree, ...late];
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `fn` once every run before it on folder `dir` is over: one at a time per work folder. */
export function oneAtATime<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const before = queues.get(dir) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(dir, tail);
  void tail.then(() => queues.get(dir) === tail && queues.delete(dir));
  return run;
}

const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

/**
 * Makes work folder `dir` free for a new run: a run recorded there past its time is stopped (its tree), one
 * still within its time is why not, in plain words. Undefined when the folder is free.
 */
export async function freeFolder(dir: string, d: GuardDeps = {}): Promise<string | undefined> {
  const o = await readOwner(dir);
  if (!o) return undefined;
  const now = (d.now ?? Date.now)();
  const tree = treeOf(await (d.list ?? listProcs)(), o);
  if (!tree.length) return void (await clearOwner(dir));
  if (now < o.deadline) return `a previous run still holds the work folder (${o.program}, started at ${hhmm(o.startedAt)}, may run until ${hhmm(o.deadline)}): try again after that`;
  await stopTree(o, d);
  await clearOwner(dir);
  return undefined;
}

export async function readOwner(dir: string): Promise<Owner | undefined> {
  try {
    const o = JSON.parse(await readFile(ownerFile(dir), 'utf8')) as Owner;
    return Number.isFinite(o.pid) && Number.isFinite(o.startedAt) && Number.isFinite(o.deadline) ? o : undefined;
  } catch {
    return undefined;
  }
}

const writeOwner = (dir: string, o: Owner) => writeFile(ownerFile(dir), JSON.stringify(o)).catch(() => undefined);
const clearOwner = (dir: string) => rm(ownerFile(dir), { force: true }).catch(() => undefined);

/** Git's words for a work folder something still has open, as a person reads them. */
export function heldWords(message: string): string {
  if (/unable to unlink|Invalid argument|EBUSY|resource busy|being used by another process|Permission denied|EPERM/i.test(message)) {
    return `a previous run still holds the work folder (a program from an earlier run has its files open, e.g. App.mpr), so it couldn't be made fresh. The office stops its own leftover programs once their time is up; try again in a few minutes. (${message.slice(0, 200)})`;
  }
  return message;
}

/** What a run started by runMxOwned is told about and asked (release 82). */
export interface RunHooks {
  /** Each line mxcli prints, as it prints it. */
  onLine?(line: string, stream: 'stdout' | 'stderr'): void;
  /** Whether the results are in (mxcli said it wrote the JUnit file): asked after each line. */
  resultsIn?(): boolean;
  /** How long mxcli may take to end once its results are in, before its tree is stopped (default 30 s). */
  graceMs?: number;
  /** How long its output may stay open once mxcli itself has ended (a child holding it), before the tree is stopped (default 5 s). */
  drainMs?: number;
}

/**
 * mxcli started by the office in work folder `dir` (runMx's answer: exit code, output, stopped, never started):
 * its pid and start recorded beside the folder; at the timeout its whole tree is stopped, and once it ends,
 * whatever it started that still runs. It answers when mxcli itself ends (its 'exit'), not only when its output
 * closes: a runtime or mxbuild it left behind inherits that output and kept the run waiting for the time limit
 * (release 82). And once the results are in (`hooks.resultsIn`), mxcli gets `graceMs` to end before its tree is
 * stopped and the run answers with them (`lingered`).
 */
export async function runMxOwned(dir: string, bin: string, args: string[], cwd: string, timeout: number, extraEnv: Record<string, string> = {}, d: GuardDeps = {}, hooks: RunHooks = {}): Promise<MxOut> {
  const now = d.now ?? Date.now;
  const t0 = now();
  const max = 64 * 1024 * 1024;
  return new Promise<MxOut>((resolve) => {
    const child = spawnOff(bin, args, { cwd, env: { ...process.env, NO_COLOR: '1', ...extraEnv }, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let killed = false;
    let lingered = false;
    let startError: string | undefined;
    let owner: Owner | undefined;
    let exitCode: number | null | undefined;
    let finished = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => {
      const t = setTimeout(fn, ms);
      (t as { unref?: () => void }).unref?.();
      timers.push(t);
    };
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      for (const t of timers) clearTimeout(t);
      void (async () => {
        // Whatever it started that outlived it (a runtime, mxbuild): stopped now, as the office's own.
        if (owner) await stopTree({ pid: owner.pid, startedAt: owner.startedAt }, d).catch(() => undefined);
        await clearOwner(dir);
        const ms = now() - t0;
        if (startError) resolve({ code: null, stdout, stderr, startError, ms });
        else if (killed) resolve({ code, stdout, stderr, killed: true, ms });
        else resolve({ code, stdout, stderr, ms, ...(lingered ? { lingered: true } : {}) });
      })();
    };
    const partial = { stdout: '', stderr: '' };
    let graceStarted = false;
    const take = (stream: 'stdout' | 'stderr', s: string) => {
      if (stream === 'stdout') stdout.length < max && (stdout += s);
      else stderr.length < max && (stderr += s);
      if (!hooks.onLine && !hooks.resultsIn) return;
      const lines = (partial[stream] + s).split('\n');
      partial[stream] = lines.pop() ?? '';
      for (const l of lines) hooks.onLine?.(l.replace(/\r$/, ''), stream);
      if (!graceStarted && hooks.resultsIn?.()) {
        graceStarted = true;
        // The results are in: mxcli has nothing left the office needs, so it isn't waited on for long.
        later(hooks.graceMs ?? 30_000, () => {
          lingered = true;
          finish(exitCode ?? null);
        });
      }
    };
    child.on('spawn', () => {
      if (child.pid === undefined) return;
      owner = { pid: child.pid, startedAt: now(), deadline: now() + timeout, program: bin.split(/[\\/]/).pop() ?? 'mxcli' };
      void writeOwner(dir, owner);
    });
    child.on('stdout', (s: string) => take('stdout', s));
    child.on('stderr', (s: string) => take('stderr', s));
    child.on('error', (e: Error & { code?: string }) => {
      if (!owner) startError = `${e.code ?? ''} ${e.message}`.trim();
    });
    later(timeout, () => {
      killed = true;
      // The whole tree, root first (stopTree): its mxbuild and runtime would otherwise keep the folder's files open.
      void (owner ? stopTree(owner, d) : Promise.resolve([])).finally(() => {
        child.kill('SIGKILL');
        // Its output may never close (a child nobody could stop holds it): answer anyway.
        later(10_000, () => finish(exitCode ?? null));
      });
    });
    child.on('exit', (code: number | null) => {
      exitCode = code ?? null;
      // mxcli ended; its output closes unless something it started still holds it. Give the output a moment, not the time limit.
      later(hooks.drainMs ?? 5_000, () => finish(exitCode ?? null));
    });
    child.on('close', (code: number | null) => {
      for (const st of ['stdout', 'stderr'] as const) if (partial[st]) hooks.onLine?.(partial[st], st);
      partial.stdout = partial.stderr = '';
      finish(code ?? exitCode ?? null);
    });
  });
}
