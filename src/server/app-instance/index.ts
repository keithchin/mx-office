// An office-run app instance: the office's own copy of a project's app at one exact commit, for work the
// office does itself (walkthrough recordings now; office-run `mxcli test` runs next), never the person's
// 🌐 Live app and never its database. It is what the live app does (liveapp/app.ts: `mxcli run --local`
// with the PostgreSQL of liveAppConfig, the password masked in the log and given as PGPASSWORD, three free
// ports, the project's mxbuild) with these differences:
//   * its files are a workspace of the office's own (./workspace.ts: <data>/testing/work/<project>/
//     instance-<purpose>, from the project's git objects; nothing in the project's folder changes), kept
//     between runs and updated in place to the commit asked for, so mxcli's build and bundle stay warm;
//   * its database is a fresh one per run (./db.ts: `<project>_<purpose>_<random>`), dropped when it stops,
//     with leftovers of an earlier run of the same purpose dropped before it starts;
//   * it waits while a live app is building (`busy`): two cold builds at once starve each other past
//     mxcli's limits; and it tries once more after a transient failure (./boot.ts), never in a loop;
//   * it lives only as long as its caller needs it: start() resolves once the app answers, stop() ends the
//     process tree and drops the database (the workspace stays), and freshDatabase() starts the same build
//     again on a new database (a caller that needs several clean starts). An office that exits takes them along.
// Each start reports its phases as they come (`onPhase`) and leaves its timing (`timing`) behind.
// mxcli, mxbuild and the runtime are child processes; the office only coordinates. Whoever starts one gets
// its address; the credentials stay here.

import type { ChildProcess } from 'node:child_process';
import { mkdirSync, statSync, truncateSync } from 'node:fs';
import { logAppender } from '../liveapp/log-append.js';
import http from 'node:http';
import path from 'node:path';
import { BOOT_PHASE_TITLE, durationWords, type BootPhase, type BootTiming } from '../../shared/app-instance.js';
import type { LiveAppConfig } from '../liveapp/config.js';
import { linuxMxbuildIn, linuxMxbuildMessage, pickMxbuild, supportsMxbuildPath, type MxbuildPick } from '../liveapp/mxbuild.js';
import { pickPorts } from '../liveapp/ports.js';
import { killTreeNow, pgBinDir, startTree, stopTree } from '../liveapp/process.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { BootClock, bootFailure, MXCLI_BUNDLE_LIMIT_MS, supportsWebClientTimeout, transientOfLine, WEB_CLIENT_TIMEOUT, WEB_CLIENT_TIMEOUT_MS, type Transient } from './boot.js';
import { dropDb, dropLeftovers, instanceDbName, instanceDbStem, realPsql, type Psql } from './db.js';
import { clearRunData, markWorkspace, prepareWorkspace, sweepWorkspaces } from './workspace.js';

export interface InstanceSpec {
  floorId: string;
  /** The project's folder: its git objects are what the workspace is made from. */
  floorDir: string;
  commit: string;
  /** A short word for what it's for ("rec", "test"): the folder, the database and the log are named by it. */
  purpose: string;
  dataDir: string;
  cfg: LiveAppConfig;
  /** The resolved mxcli, or null when there's none on this machine. */
  mxcli: string | null;
  /** Ports something else of the office holds (the live apps, their consoles). */
  taken?(): Iterable<number>;
  /** What is building now that this start should wait for ("the project’s live app"), or undefined. */
  busy?(): string | undefined;
  /** How long to wait for `busy` at most before starting anyway (default 12 min), and how often to ask (2 s). */
  waitMs?: number;
  waitPollMs?: number;
  signal?: AbortSignal;
  /** Where it is in words ("Waiting for the project’s live app…", "Tried once more: …"), for the caller's page. */
  progress?(line: string): void;
  /** Each boot phase as it starts, with when (the caller shows the elapsed time). */
  onPhase?(phase: BootPhase, at: number): void;
  /** Stand-ins for tests: psql, the mxbuild pick and the --web-client-timeout probe. */
  psql?: Psql;
  mxbuild?: { pick(mpr: string, floorEnv: Record<string, string>): MxbuildPick; supportsFlag(mxcli: string): Promise<boolean> };
  webClientTimeout?(mxcli: string): Promise<boolean>;
}

export interface AppInstance {
  /** http://127.0.0.1:<app port>/: the only origin a caller should reach (a retried start may move it). */
  readonly url: string;
  readonly appPort: number;
  /** mxcli's process id while it runs (the root of the tree stop() ends): for a caller that keeps a record of what it started. */
  readonly pid: number | undefined;
  commit: string;
  /** The database this run made (dropped by stop()). */
  readonly dbName: string;
  /** Its log file (passwords masked); it outlives the instance. */
  logFile: string;
  /** The Mendix runtime's own log (mxcli's <project>/.mxcli/runtime.log), while it runs: where the runtime says why it refused something. */
  runtimeLog: string;
  /** What the last start (or fresh database) took, phase by phase, and whether it was tried once more. */
  readonly timing: BootTiming;
  /** Still running. */
  alive(): boolean;
  /**
   * The same build on a new, fresh database: the runtime stops, its database is dropped, and it starts again
   * in the same workspace with a database of its own. For a caller that needs several clean starts (a
   * walkthrough batch's groups). Resolves once the app answers.
   */
  freshDatabase(signal?: AbortSignal, progress?: (line: string) => void, onPhase?: (phase: BootPhase, at: number) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Ports the office's instances hold now: the live apps leave them alone (liveapp/index.ts). */
const claimed = new Set<number>();
export const instancePorts = (): ReadonlySet<number> => claimed;

/** Holds `ports` for another runtime the office starts (a microflow test run) so the live apps and instances leave them alone; gives their release. */
export function holdPorts(ports: readonly number[]): () => void {
  for (const p of ports) claimed.add(p);
  return () => {
    for (const p of ports) claimed.delete(p);
  };
}

/** Workspaces an instance runs in now: one start per workspace at a time. */
const inUse = new Set<string>();

const running = new Set<ChildProcess>();
let exitHooked = false;

const POLL_MS = 1_000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;

/** The workspace and the log of an instance: under the office's work folders, never in the project's. */
export const instanceDir = (dataDir: string, floorId: string, purpose: string) => path.join(dataDir, 'testing', 'work', floorId, `instance-${purpose}`);

const reasonOf = (signal: AbortSignal | undefined) => (typeof signal?.reason === 'string' ? signal.reason : 'cancelled');

/** Starts the app at `spec.commit` with a fresh database; resolves once it answers HTTP. */
export async function startAppInstance(spec: InstanceSpec): Promise<AppInstance> {
  const { cfg } = spec;
  if (!spec.mxcli) throw new Error(`mxcli isn't installed on the office's machine (looked for "${cfg.mxcli}"; set AGENT_OFFICE_LIVE_MXCLI)`);
  const mxcli = spec.mxcli;
  const psql = spec.psql ?? realPsql;
  const dir = instanceDir(spec.dataDir, spec.floorId, spec.purpose);
  const key = path.resolve(dir);
  if (inUse.has(key)) throw new Error(`the ${spec.purpose} app of this project is running already`);
  inUse.add(key);
  const logFile = `${dir}.log`;
  mkdirSync(path.dirname(dir), { recursive: true });
  try {
    if (statSync(logFile).size > LOG_MAX_BYTES) truncateSync(logFile, 0);
  } catch {
    // No log yet.
  }
  const db = cfg.db;
  const lines: string[] = [];
  const log = logAppender(logFile);
  const note = (line: string) => {
    const l = db.password ? line.replaceAll(db.password, '***') : line;
    lines.push(l.length > 400 ? `${l.slice(0, 400)}…` : l);
    if (lines.length > 40) lines.splice(0, lines.length - 40);
    try {
      log(l);
    } catch {
      // The log is a convenience.
    }
  };
  note(`\n=== ${new Date().toISOString()} ${spec.purpose} @${spec.commit.slice(0, 12)}`);
  let child: ChildProcess | null = null;
  let ports: number[] = [];
  /** The app's port of the last start that came up (kept after stop, for the caller's records). */
  let appPort = 0;
  let dbName = '';
  let dbMade = false;
  let stopped = false;
  let timing: BootTiming = { ms: 0, phases: {} };
  const endChild = async () => {
    if (!child) return;
    const c = child;
    child = null;
    await stopTree(c);
    running.delete(c);
  };
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    spec.signal?.removeEventListener('abort', onAbort);
    await endChild();
    for (const p of ports) claimed.delete(p);
    ports = [];
    if (dbMade) await dropDb(psql, db, dbName).catch((err: Error) => note(`couldn't drop ${dbName}: ${err.message}`));
    inUse.delete(key);
    note(`stopped; ${dbName || 'no database'} dropped (the workspace stays for the next run)`);
    await log.flush();
  };
  const onAbort = () => void stop();
  spec.signal?.addEventListener('abort', onAbort, { once: true });
  const clock = new BootClock(spec.busy ? 'waiting' : 'workspace', Date.now, spec.onPhase);
  const sweep = sweepWorkspaces(spec.dataDir, dir).catch(() => []);
  try {
    if (spec.busy) await waitForQuiet(spec, clock, note);
    clock.enter('workspace');
    spec.progress?.(`Getting @${spec.commit.slice(0, 7)} into the recording workspace…`);
    const ws = await prepareWorkspace(spec.floorDir, spec.commit, dir, spec.dataDir);
    note(`workspace: ${ws.how === 'fresh' ? 'a first copy' : ws.how === 'reused' ? `kept as it was (@${ws.commit.slice(0, 12)})` : `updated in place to @${ws.commit.slice(0, 12)}`} (${durationWords(clock.phaseElapsed())})`);
    const gone = await sweep;
    if (gone.length) note(`removed workspaces nobody used for a while: ${gone.length}`);
    if (spec.signal?.aborted) throw new Error(reasonOf(spec.signal));
    const mpr = path.join(ws.dir, ...ws.mpr.split('/'));
    const cwd = path.dirname(mpr);
    clock.enter('database');
    dbName = instanceDbName(spec.floorId, spec.purpose);
    const left = await dropLeftovers(psql, db, instanceDbStem(spec.floorId, spec.purpose), dbName).catch(() => []);
    if (left.length) note(`dropped what earlier runs left: ${left.join(', ')}`);
    if (spec.signal?.aborted) throw new Error(reasonOf(spec.signal));
    await takePorts();
    const args = ['run', '--local', '-p', path.basename(mpr), '--app-port', '', '--admin-port', '', '--serve-port', ''];
    args.push('--db-host', `${db.host.includes(':') ? `[${db.host}]` : db.host}:${db.port}`, '--db-user', db.user, '--db-password', db.password, '--db-name', dbName, '--ensure-db');
    const floorEnv = floorToolkitEnv(spec.floorDir);
    const pick = (spec.mxbuild?.pick ?? pickMxbuild)(mpr, floorEnv);
    const extra: Record<string, string> = {};
    let flag: boolean | undefined;
    if (pick.path) {
      flag = await (spec.mxbuild?.supportsFlag ?? supportsMxbuildPath)(mxcli);
      if (flag) args.push('--mxbuild-path', pick.path);
      extra.MXBUILD_PATH = pick.path;
    }
    // A cold bundle on a busy machine can pass mxcli's default 5 min; a newer mxcli can be given longer.
    const longBundle = await (spec.webClientTimeout ?? supportsWebClientTimeout)(mxcli).catch(() => false);
    if (longBundle) args.push('--web-client-timeout', WEB_CLIENT_TIMEOUT);
    const bundleLimit = longBundle ? WEB_CLIENT_TIMEOUT_MS : MXCLI_BUNDLE_LIMIT_MS;
    const env = { ...floorEnv, ...extra, PGPASSWORD: db.password };
    let current = args;
    const startOnce = async (signal: AbortSignal | undefined, progress: ((l: string) => void) | undefined, c: BootClock) => {
      // A retry may move the database (and the ports): what the next fresh start builds on.
      const a = [...current];
      const t = await launchWithRetry(a, cwd, env, pick, flag, bundleLimit, progress, signal, c);
      current = a;
      return t;
    };
    timing = await startOnce(spec.signal, spec.progress, clock).then((t) => ({ ...t, workspace: ws.how }));
    await markWorkspace(dir, ws, true);
    note(`answering on ${ports[0]} (${dbName}) after ${durationWords(timing.ms)}${timing.bundleMs !== undefined ? `; the bundle took ${durationWords(timing.bundleMs)}` : ''}`);
    await log.flush();
    return {
      get url() {
        return `http://127.0.0.1:${appPort}/`;
      },
      get appPort() {
        return appPort;
      },
      commit: ws.commit,
      get dbName() {
        return dbName;
      },
      get timing() {
        return timing;
      },
      get pid() {
        return child?.pid;
      },
      logFile,
      runtimeLog: path.join(cwd, '.mxcli', 'runtime.log'),
      alive: () => !stopped && !!child && child.exitCode === null,
      freshDatabase: async (signal, progress, onPhase) => {
        if (stopped) throw new Error('the app instance is stopped');
        const was = dbName;
        const c = new BootClock('database', Date.now, onPhase);
        await endChild();
        if (dbMade) await dropDb(psql, db, was).catch((err: Error) => note(`couldn't drop ${was}: ${err.message}`));
        dbMade = false;
        await clearRunData(cwd);
        dbName = instanceDbName(spec.floorId, spec.purpose);
        note(`=== fresh database: ${was} dropped, ${dbName} next`);
        const next = [...current];
        next[next.indexOf('--db-name') + 1] = dbName;
        current = next;
        const onCancel = () => void stop();
        signal?.addEventListener('abort', onCancel, { once: true });
        try {
          if (signal?.aborted) throw new Error(reasonOf(signal));
          progress?.('Starting the same build again on a fresh database…');
          timing = await startOnce(signal, progress, c).then((t) => ({ ...t, workspace: 'reused' as const }));
          note(`answering on ${ports[0]} (${dbName}) after ${durationWords(timing.ms)}`);
          await log.flush();
        } catch (err) {
          note(`✖ ${(err as Error).message}`);
          await stop();
          throw err;
        } finally {
          signal?.removeEventListener('abort', onCancel);
        }
      },
      stop,
    };
  } catch (err) {
    note(`✖ ${(err as Error).message}`);
    await stop();
    throw err;
  }

  /** Three free ports (none of `avoid`), claimed so the live apps leave them alone. */
  async function takePorts(avoid: Iterable<number> = []) {
    for (const p of ports) claimed.delete(p);
    ports = [];
    const got = await pickPorts(3, cfg.ports, new Set([...(spec.taken?.() ?? []), ...claimed, ...avoid]));
    if (!got) throw new Error(`No three free ports left in ${cfg.ports.from}-${cfg.ports.to} (AGENT_OFFICE_LIVE_PORTS)`);
    ports = got;
    for (const p of ports) claimed.add(p);
  }

  /** One start, and one more after a transient failure (other ports when a port was the trouble). */
  async function launchWithRetry(args: string[], cwd: string, env: Record<string, string>, pick: MxbuildPick, flag: boolean | undefined, bundleLimit: number, progress: ((l: string) => void) | undefined, signal: AbortSignal | undefined, c: BootClock): Promise<BootTiming> {
    const withPorts = () => {
      const a = [...args];
      a[a.indexOf('--app-port') + 1] = String(ports[0]);
      a[a.indexOf('--admin-port') + 1] = String(ports[1]);
      a[a.indexOf('--serve-port') + 1] = String(ports[2]);
      return a;
    };
    const first = await launch(withPorts(), cwd, env, pick, flag, bundleLimit, progress, signal, c).then(
      () => undefined,
      (err: Error & { transient?: Transient }) => err,
    );
    if (!first) return c.timing();
    if (!first.transient || signal?.aborted || stopped) throw first;
    const retried = first.transient.words;
    note(`the app failed to start once (${retried}); trying once more${first.transient.kind === 'port' ? ' on other ports' : ''}`);
    progress?.(`It failed to start once (${retried}); trying once more…`);
    if (first.transient.kind === 'port') await takePorts([...ports, ...(first.transient.port ? [first.transient.port] : [])]);
    // The runtime may have got as far as the database: the next try gets a fresh one too.
    const was = dbName;
    if (dbMade) await dropDb(psql, db, was).catch((err: Error) => note(`couldn't drop ${was}: ${err.message}`));
    dbMade = false;
    dbName = instanceDbName(spec.floorId, spec.purpose);
    args[args.indexOf('--db-name') + 1] = dbName;
    c.enter('building');
    await launch(withPorts(), cwd, env, pick, flag, bundleLimit, progress, signal, c, retried);
    return c.timing({ retried });
  }

  /** Runs mxcli with `args` and waits until the app answers (or says, phase and all, why it didn't start). */
  async function launch(args: string[], cwd: string, env: Record<string, string>, pick: MxbuildPick, flag: boolean | undefined, bundleLimit: number, progress: ((l: string) => void) | undefined, signal: AbortSignal | undefined, c: BootClock, retried?: string): Promise<void> {
    const aborted = () => {
      if (signal?.aborted || stopped) throw new Error(reasonOf(signal));
    };
    const app = Number(args[args.indexOf('--app-port') + 1]);
    note(`$ mxcli ${args.map((a, i) => (args[i - 1] === '--db-password' ? '***' : a)).join(' ')}`);
    if (!retried) progress?.(`Building @${spec.commit.slice(0, 7)} and starting it on a fresh database…`);
    lines.length = 0;
    const ch = startTree(mxcli, args, cwd, env, pgBinDir());
    child = ch;
    dbMade = true;
    running.add(ch);
    if (!exitHooked) {
      exitHooked = true;
      process.once('exit', () => {
        for (const r of running) if (r.pid) killTreeNow(r.pid);
      });
    }
    let transient: Transient | undefined;
    let partial = '';
    const onData = (buf: Buffer) => {
      const ls = (partial + buf.toString('utf8')).split(/\r?\n/);
      partial = ls.pop() ?? '';
      for (const l of ls) {
        if (!l.trim()) continue;
        note(l);
        c.line(l);
        const t = transientOfLine(l);
        if (t && (!transient || (t.kind === 'port' && 'port' in t && t.port && !(transient.kind === 'port' && transient.port)))) transient = t;
      }
    };
    ch.stdout?.on('data', onData);
    ch.stderr?.on('data', onData);
    const st: { exited?: string } = {};
    ch.once('error', (err) => (st.exited = `mxcli didn't start: ${err.message}`));
    ch.once('exit', (code) => {
      running.delete(ch);
      if (child === ch) child = null;
      st.exited ??= `mxcli exited (code ${code ?? '?'})`;
    });
    const t0 = Date.now();
    const fail = async (why: string, kind: 'port' | 'bundle' | 'timeout' | 'other') => {
      await endChild();
      const e = new Error(bootFailure(c.phase, c.phaseElapsed(), why, logFile, kind, retried)) as Error & { transient?: Transient };
      if (transient && !retried) e.transient = transient;
      return e;
    };
    for (;;) {
      aborted();
      if (st.exited) {
        // Give the last lines a moment to arrive (the reason is often the last thing mxcli prints).
        await new Promise((r) => setTimeout(r, 100));
        const linux = linuxMxbuildIn(lines);
        if (linux) throw new Error(linuxMxbuildMessage(linux, pick, flag, mxcli));
        if (transient) throw await fail(transient.words, transient.kind);
        const said = [...lines].reverse().find((l) => /error|exception|failed/i.test(l));
        throw await fail(`the app didn't start: ${said ? `${said.replace(/^error:\s*/i, '')} (${st.exited})` : st.exited}`, 'other');
      }
      if (await answers(app)) {
        appPort = app;
        break;
      }
      // The office's limit, but never in the middle of a bundle mxcli still has time for: its own verdict says more.
      const limit = Math.max(t0 + cfg.readyTimeoutMs, c.phase === 'bundling' ? c.phaseAt + bundleLimit + 60_000 : 0);
      if (Date.now() > limit) throw await fail(`the app didn't answer on port ${app} within ${durationWords(Date.now() - t0)}`, 'timeout');
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

/** Waits while `spec.busy()` names something building (a live app), up to `spec.waitMs`; says so as it waits. */
async function waitForQuiet(spec: InstanceSpec, clock: BootClock, note: (l: string) => void): Promise<void> {
  const cap = spec.waitMs ?? 12 * 60_000;
  const poll = spec.waitPollMs ?? 2_000;
  let said = '';
  for (;;) {
    if (spec.signal?.aborted) throw new Error(reasonOf(spec.signal));
    const what = spec.busy?.();
    if (!what) {
      if (said) note(`${said} is done building: starting (waited ${durationWords(clock.phaseElapsed())})`);
      return;
    }
    if (what !== said) {
      said = what;
      note(`waiting for ${what} to finish building before starting`);
      spec.progress?.(`${BOOT_PHASE_TITLE.waiting.replace('the live app', what)}: two builds at once slow each other past mxcli’s limits…`);
    }
    if (clock.phaseElapsed() > cap) {
      note(`${what} is still building after ${durationWords(cap)}: starting anyway`);
      spec.progress?.(`${what} is still building after ${durationWords(cap)}: starting anyway…`);
      return;
    }
    await new Promise((r) => setTimeout(r, poll));
  }
}

/** Whether something answers HTTP on the port yet (any status but a gateway error counts). */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 5_000 }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.once('timeout', () => req.destroy());
    req.once('error', () => resolve(false));
  });
}
