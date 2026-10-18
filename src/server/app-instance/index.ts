// An office-run app instance: the office's own throwaway copy of a project's app at one exact commit, for
// work the office does itself (walkthrough recordings now; office-run `mxcli test` runs next), never the
// person's 🌐 Live app and never its database. It is what the live app does (liveapp/app.ts: `mxcli run
// --local` with the PostgreSQL of liveAppConfig, the password masked in the log and given as PGPASSWORD,
// three free ports, the project's mxbuild) with three differences:
//   * its files are a fresh copy of the commit in the office's work folder (testing/workfolder.ts, from the
//     project's git objects; nothing in the project's folder changes), wiped when it stops;
//   * its database is a fresh one per run (./db.ts: `<project>_<purpose>_<random>`), dropped when it stops,
//     with leftovers of an earlier run of the same purpose dropped before it starts;
//   * it lives only as long as its caller needs it: start() resolves once the app answers, stop() ends the
//     process tree, drops the database and wipes the folder. An office that exits takes the processes along.
// mxcli, mxbuild and the runtime are child processes; the office only coordinates. Whoever starts one gets
// its address; the credentials stay here.

import type { ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { LiveAppConfig } from '../liveapp/config.js';
import { linuxMxbuildIn, linuxMxbuildMessage, pickMxbuild, supportsMxbuildPath, type MxbuildPick } from '../liveapp/mxbuild.js';
import { pickPorts } from '../liveapp/ports.js';
import { killTreeNow, pgBinDir, startTree, stopTree } from '../liveapp/process.js';
import { floorToolkitEnv } from '../toolkit-env.js';
import { checkoutAt, disposeFolder } from '../testing/workfolder.js';
import { dropDb, dropLeftovers, instanceDbName, instanceDbStem, realPsql, type Psql } from './db.js';

export interface InstanceSpec {
  floorId: string;
  /** The project's folder: its git objects are what the copy is made from. */
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
  signal?: AbortSignal;
  /** Where it is ("Copying @abc1234…", "Building…"), for the caller's page. */
  progress?(line: string): void;
  /** Stand-ins for tests: psql and the mxbuild pick. */
  psql?: Psql;
  mxbuild?: { pick(mpr: string, floorEnv: Record<string, string>): MxbuildPick; supportsFlag(mxcli: string): Promise<boolean> };
}

export interface AppInstance {
  /** http://127.0.0.1:<app port>/: the only origin a caller should reach. */
  url: string;
  appPort: number;
  commit: string;
  /** The database this run made (dropped by stop()). */
  dbName: string;
  /** Its log file (passwords masked); it outlives the instance. */
  logFile: string;
  /** Still running. */
  alive(): boolean;
  stop(): Promise<void>;
}

/** Ports the office's instances hold now: the live apps leave them alone (liveapp/index.ts). */
const claimed = new Set<number>();
export const instancePorts = (): ReadonlySet<number> => claimed;

const running = new Set<ChildProcess>();
let exitHooked = false;

const POLL_MS = 1_000;

/** The folder and the log of an instance: under the office's work folders, never in the project's. */
export const instanceDir = (dataDir: string, floorId: string, purpose: string) => path.join(dataDir, 'testing', 'work', floorId, `instance-${purpose}`);

/** Starts the app at `spec.commit` with a fresh database; resolves once it answers HTTP. */
export async function startAppInstance(spec: InstanceSpec): Promise<AppInstance> {
  const { cfg } = spec;
  if (!spec.mxcli) throw new Error(`mxcli isn't installed on the office's machine (looked for "${cfg.mxcli}"; set AGENT_OFFICE_LIVE_MXCLI)`);
  const psql = spec.psql ?? realPsql;
  const dir = instanceDir(spec.dataDir, spec.floorId, spec.purpose);
  const logFile = `${dir}.log`;
  mkdirSync(path.dirname(dir), { recursive: true });
  const db = cfg.db;
  const lines: string[] = [];
  const note = (line: string) => {
    const l = line.replaceAll(db.password, '***');
    lines.push(l.length > 400 ? `${l.slice(0, 400)}…` : l);
    if (lines.length > 40) lines.splice(0, lines.length - 40);
    try {
      appendFileSync(logFile, `${l}\n`);
    } catch {
      // The log is a convenience.
    }
  };
  const aborted = () => {
    if (spec.signal?.aborted) throw new Error(typeof spec.signal.reason === 'string' ? spec.signal.reason : 'cancelled');
  };
  note(`\n=== ${new Date().toISOString()} ${spec.purpose} @${spec.commit.slice(0, 12)}`);
  let child: ChildProcess | null = null;
  let ports: number[] = [];
  let dbName = '';
  let dbMade = false;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    spec.signal?.removeEventListener('abort', onAbort);
    if (child) {
      const c = child;
      child = null;
      await stopTree(c);
      running.delete(c);
    }
    for (const p of ports) claimed.delete(p);
    ports = [];
    if (dbMade) await dropDb(psql, db, dbName).catch((err: Error) => note(`couldn't drop ${dbName}: ${err.message}`));
    await disposeFolder(dir);
    note(`stopped; ${dbName} dropped`);
  };
  const onAbort = () => void stop();
  spec.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    aborted();
    spec.progress?.(`Copying @${spec.commit.slice(0, 7)} into the office’s work folder…`);
    const wf = await checkoutAt(spec.floorDir, spec.commit, dir, spec.dataDir);
    aborted();
    const mpr = path.join(wf.dir, ...wf.mpr.split('/'));
    dbName = instanceDbName(spec.floorId, spec.purpose);
    const left = await dropLeftovers(psql, db, instanceDbStem(spec.floorId, spec.purpose), dbName).catch(() => []);
    if (left.length) note(`dropped what earlier runs left: ${left.join(', ')}`);
    aborted();
    const got = await pickPorts(3, cfg.ports, new Set([...(spec.taken?.() ?? []), ...claimed]));
    if (!got) throw new Error(`No three free ports left in ${cfg.ports.from}-${cfg.ports.to} (AGENT_OFFICE_LIVE_PORTS)`);
    ports = got;
    for (const p of ports) claimed.add(p);
    const [app, admin, serve] = ports;
    const args = ['run', '--local', '-p', path.basename(mpr), '--app-port', String(app), '--admin-port', String(admin), '--serve-port', String(serve)];
    args.push('--db-host', `${db.host.includes(':') ? `[${db.host}]` : db.host}:${db.port}`, '--db-user', db.user, '--db-password', db.password, '--db-name', dbName, '--ensure-db');
    const floorEnv = floorToolkitEnv(spec.floorDir);
    const pick = (spec.mxbuild?.pick ?? pickMxbuild)(mpr, floorEnv);
    const extra: Record<string, string> = {};
    let flag: boolean | undefined;
    if (pick.path) {
      flag = await (spec.mxbuild?.supportsFlag ?? supportsMxbuildPath)(spec.mxcli);
      if (flag) args.push('--mxbuild-path', pick.path);
      extra.MXBUILD_PATH = pick.path;
    }
    aborted();
    note(`$ mxcli ${args.map((a, i) => (args[i - 1] === '--db-password' ? '***' : a)).join(' ')}`);
    spec.progress?.(`Building @${spec.commit.slice(0, 7)} and starting it on a fresh database (a cold start takes a minute or two)…`);
    const c = startTree(spec.mxcli, args, path.dirname(mpr), { ...floorEnv, ...extra, PGPASSWORD: db.password }, pgBinDir());
    child = c;
    dbMade = true;
    running.add(c);
    if (!exitHooked) {
      exitHooked = true;
      process.once('exit', () => {
        for (const r of running) if (r.pid) killTreeNow(r.pid);
      });
    }
    let partial = '';
    const onData = (buf: Buffer) => {
      const ls = (partial + buf.toString('utf8')).split(/\r?\n/);
      partial = ls.pop() ?? '';
      for (const l of ls) if (l.trim()) note(l);
    };
    c.stdout?.on('data', onData);
    c.stderr?.on('data', onData);
    const st: { exited?: string } = {};
    c.once('error', (err) => (st.exited = `mxcli didn't start: ${err.message}`));
    c.once('exit', (code) => {
      running.delete(c);
      if (child === c) child = null;
      st.exited ??= `mxcli exited (code ${code ?? '?'})`;
    });
    const deadline = Date.now() + cfg.readyTimeoutMs;
    for (;;) {
      aborted();
      if (st.exited) {
        const linux = linuxMxbuildIn(lines);
        const said = [...lines].reverse().find((l) => /error|exception|failed/i.test(l));
        throw new Error(linux ? linuxMxbuildMessage(linux, pick, flag, spec.mxcli) : `the app didn't start: ${said ? `${said.replace(/^error:\s*/i, '')} (${st.exited})` : st.exited}`);
      }
      if (await answers(app)) break;
      if (Date.now() > deadline) throw new Error(`the app didn't answer on port ${app} within ${Math.round(cfg.readyTimeoutMs / 60_000)} min`);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    note(`answering on ${app} (${dbName})`);
    return {
      url: `http://127.0.0.1:${app}/`,
      appPort: app,
      commit: wf.commit,
      dbName,
      logFile,
      alive: () => !stopped && !!child && child.exitCode === null,
      stop,
    };
  } catch (err) {
    note(`✖ ${(err as Error).message}`);
    await stop();
    throw err;
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
