// Starting a program off the event loop. On Windows, libuv starts every child process (CreateProcess)
// on the thread that asks, and that call alone can take seconds: a binary the virus scanner hasn't
// seen yet (a fresh gh or claude after an update, a test office's shims), a slow PATH. The office's
// own `execFile('gh' | 'git', …)` calls ran on the main thread, so each such start froze every page,
// hook and worker for that long (the journey's 3–16 s stall after the clone step, 2026-10-07).
//
// `execFileOff` is execFile's callback shape and `spawnOff` a small stand-in for spawn's child (its
// output as events, stdin, kill), but the program is started from a worker thread of its own (one,
// made on first use and let go when idle), so the main thread only posts a message. What comes back
// is the same: stdout and stderr as strings, and an error with execFile's fields (code, killed,
// signal, stdout, stderr) when it failed. If the worker can't be made, both fall back to starting the
// program here, so nothing stops working.

import { execFile, spawn, type ExecFileOptions, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { SHARE_ENV, Worker } from 'node:worker_threads';

export interface OffOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  maxBuffer?: number;
  windowsHide?: boolean;
  /** Windows: hand the arguments to the program as they are (cmd.exe /s /c "…" for a .cmd shim). */
  windowsVerbatimArguments?: boolean;
  /** Written to the program's stdin, which is then closed. */
  input?: string;
}

export type OffError = Error & { code?: number | string; killed?: boolean; signal?: string | null; stdout?: string; stderr?: string };
type Done = (err: OffError | null, stdout: string, stderr: string) => void;

// The worker's own code, plain CommonJS so it runs the same under tsx (tests) and from dist.
const WORKER = `
const { parentPort } = require('node:worker_threads');
const { execFile, spawn } = require('node:child_process');
const kids = new Map();
const post = (m) => parentPort.postMessage(m);
const errOf = (err) => ({ message: String((err && err.message) || err), code: err && err.code, killed: err && err.killed, signal: err && err.signal });
parentPort.on('message', (m) => {
  if (m.op === 'exec') {
    let child;
    try {
      child = execFile(m.file, m.args, m.opts, (err, stdout, stderr) => post({ id: m.id, ev: 'done', err: err && errOf(err), stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
    } catch (err) {
      return post({ id: m.id, ev: 'done', err: errOf(err), stdout: '', stderr: '' });
    }
    if (m.input != null && child.stdin) {
      child.stdin.on('error', () => {});
      child.stdin.end(m.input);
    }
  } else if (m.op === 'spawn') {
    let child;
    try {
      child = spawn(m.file, m.args, m.opts);
    } catch (err) {
      post({ id: m.id, ev: 'error', err: errOf(err) });
      return post({ id: m.id, ev: 'close', code: null, signal: null });
    }
    kids.set(m.id, child);
    post({ id: m.id, ev: 'spawn', pid: child.pid });
    child.stdout?.on('data', (d) => post({ id: m.id, ev: 'stdout', data: m.binary ? d : d.toString('utf8') }));
    child.stderr?.on('data', (d) => post({ id: m.id, ev: 'stderr', data: d.toString('utf8') }));
    child.stdin?.on('error', () => {});
    child.on('error', (err) => post({ id: m.id, ev: 'error', err: errOf(err) }));
    child.on('close', (code, signal) => {
      kids.delete(m.id);
      post({ id: m.id, ev: 'close', code, signal });
    });
  } else {
    const child = kids.get(m.id);
    if (!child) return;
    if (m.op === 'write') child.stdin?.write(m.data);
    else if (m.op === 'end') child.stdin?.end();
    else if (m.op === 'kill') child.kill(m.signal);
  }
});
`;

type Msg = { id: number; ev: string; err?: { message: string; code?: number | string; killed?: boolean; signal?: string | null }; stdout?: string; stderr?: string; data?: string | Uint8Array; pid?: number; code?: number | null; signal?: NodeJS.Signals | null };

let worker: Worker | undefined;
let broken = false;
let nextId = 1;
const pending = new Map<number, (m: Msg) => void>();

const errFrom = (e: NonNullable<Msg['err']>, extra: object = {}): OffError => Object.assign(new Error(e.message), { code: e.code, killed: e.killed, signal: e.signal }, extra);

function settle(id: number) {
  pending.delete(id);
  if (!pending.size) worker?.unref();
}

function failAll(why: string) {
  for (const [id, take] of [...pending]) {
    pending.delete(id);
    take({ id, ev: 'lost', err: { message: why, code: 'EWORKER' } });
  }
}

function theWorker(): Worker | undefined {
  if (worker || broken) return worker;
  try {
    const w = new Worker(WORKER, { eval: true, env: SHARE_ENV, stdout: false, stderr: false });
    w.on('message', (m: Msg) => pending.get(m.id)?.(m));
    w.on('error', (e: Error) => {
      console.warn(`agent-office: the process starter thread failed, starting programs on the main thread from now: ${e.message}`);
      broken = true;
      worker = undefined;
      failAll(`the process starter thread failed: ${e.message}`);
    });
    w.on('exit', () => {
      if (worker === w) worker = undefined;
      failAll('the process starter thread exited');
    });
    w.unref();
    worker = w;
  } catch (e) {
    broken = true;
    console.warn(`agent-office: couldn't start the process starter thread, starting programs on the main thread: ${(e as Error).message}`);
  }
  return worker;
}

/** Posts `m` to the worker under a new id, `take` hearing what comes back; false when there's no worker. */
function send(m: object, take: (m: Msg) => void): number | undefined {
  const w = theWorker();
  if (!w) return undefined;
  const id = nextId++;
  pending.set(id, take);
  w.ref();
  w.postMessage({ ...m, id });
  return id;
}

/** The worker shares this process's environment (SHARE_ENV), so no env means the same as here; a given one is copied (it's posted). */
const envOpt = (env: NodeJS.ProcessEnv | undefined) => (env ? { env: { ...env } } : {});

/** execFile, started from a worker thread (see above). Strings out, utf8. */
export function execFileOff(file: string, args: readonly string[], opts: OffOptions, done: Done): void {
  const { input, env, ...rest } = opts;
  const o: ExecFileOptions = { windowsHide: true, ...rest, ...envOpt(env), encoding: 'utf8' };
  const id = send({ op: 'exec', file, args: [...args], opts: o, input }, (m) => {
    settle(m.id);
    const stdout = m.stdout ?? '';
    const stderr = m.stderr ?? '';
    done(m.err ? errFrom(m.err, { stdout, stderr }) : null, stdout, stderr);
  });
  if (id !== undefined) return;
  const child = execFile(file, [...args], o, (err, stdout, stderr) => done(err as OffError | null, String(stdout ?? ''), String(stderr ?? '')));
  if (input != null && child.stdin) {
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  }
}

/** execFileOff as a promise: { stdout, stderr }, or a rejection with execFile's error fields. */
export function execFileOffP(file: string, args: readonly string[], opts: OffOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => execFileOff(file, args, opts, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr }))));
}

/**
 * A program started off the event loop, as far as the office uses spawn's child: `pid` (once it's
 * started), 'stdout' and 'stderr' events with utf8 text, 'error' (with execFile's fields), 'close'
 * (code, signal), and `write`, `end` and `kill`. Its 'spawn' event says it started.
 */
export class OffChild extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  closed = false;
  constructor(private ctl: (m: object) => void) {
    super();
  }
  write(data: string) {
    if (!this.closed) this.ctl({ op: 'write', data });
  }
  end() {
    if (!this.closed) this.ctl({ op: 'end' });
  }
  kill(signal: NodeJS.Signals = 'SIGTERM') {
    if (!this.closed) this.ctl({ op: 'kill', signal });
  }
}

export interface SpawnOffOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
  detached?: boolean;
  /** Through the shell (a .cmd or .bat on Windows). */
  shell?: boolean;
  /** Whether stdin is a pipe to write to (else ignored). */
  stdin?: boolean;
  /** stdout as bytes (a Uint8Array per 'stdout' event) instead of utf8 text, for a program that prints binary (git cat-file). */
  binary?: boolean;
}

/** spawn, started from a worker thread (see above). stdout and stderr are pipes; stdin is one when `stdin` says so. */
export function spawnOff(file: string, args: readonly string[], opts: SpawnOffOptions = {}): OffChild {
  const { stdin, env, binary, ...rest } = opts;
  const o: SpawnOptions = { windowsHide: true, ...rest, ...envOpt(env), stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] };
  let id: number | undefined;
  const child = new OffChild((m) => id !== undefined && worker?.postMessage({ ...m, id }));
  const take = (m: Msg) => {
    if (m.ev === 'spawn') {
      child.pid = m.pid;
      child.emit('spawn');
    } else if (m.ev === 'stdout' || m.ev === 'stderr') child.emit(m.ev, m.data ?? '');
    else if (m.ev === 'error') child.emit('error', errFrom(m.err!));
    else if (m.ev === 'close' || m.ev === 'lost') {
      settle(m.id);
      if (m.ev === 'lost') child.emit('error', errFrom(m.err!));
      child.closed = true;
      child.exitCode = m.code ?? null;
      child.signalCode = m.signal ?? null;
      child.emit('close', m.code ?? null, m.signal ?? null);
    }
  };
  id = send({ op: 'spawn', file, args: [...args], opts: o, binary }, take);
  if (id !== undefined) return child;
  // No worker: start it here, wired to the same events.
  const local = spawn(file, [...args], o);
  const ctl = (m: { op: string; data?: string; signal?: NodeJS.Signals }) => (m.op === 'write' ? local.stdin?.write(m.data!) : m.op === 'end' ? local.stdin?.end() : local.kill(m.signal));
  const fallback = new OffChild((m) => ctl(m as never));
  fallback.pid = local.pid;
  local.stdout?.on('data', (d: Buffer) => fallback.emit('stdout', binary ? d : d.toString('utf8')));
  local.stderr?.on('data', (d: Buffer) => fallback.emit('stderr', d.toString('utf8')));
  local.stdin?.on('error', () => undefined);
  local.on('spawn', () => fallback.emit('spawn'));
  local.on('error', (e) => fallback.emit('error', e));
  local.on('close', (code, signal) => {
    fallback.closed = true;
    fallback.exitCode = code;
    fallback.signalCode = signal;
    fallback.emit('close', code, signal);
  });
  return fallback;
}

/** Lets the worker go (tests, shutdown); the next call makes a new one. */
export function stopExecWorker(): Promise<void> {
  const w = worker;
  worker = undefined;
  return w ? w.terminate().then(() => undefined) : Promise.resolve();
}
