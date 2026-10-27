// Running mxcli and ending it again. `mxcli run --local` starts mxbuild and a Java runtime under
// it, so stopping it means stopping the whole tree, or the ports stay taken; and it asks psql to
// make the app's database when that's missing, so PostgreSQL's bin folder goes on its PATH.

import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../workers/env.js';
import { resolveCommand } from '../workers/process.js';
import { macPgBinDir } from './pg-mac.js';

const WIN = process.platform === 'win32';

let pgBin: { key: string; dir: string | undefined } | undefined;

/**
 * The folder psql is in, when it isn't on PATH already: AGENT_OFFICE_LIVE_PG_BIN, or the newest
 * PostgreSQL the Windows installer put under Program Files (macOS: Postgres.app or a Homebrew
 * postgresql@<n>, pg-mac.ts). Undefined when there's nothing to add.
 */
export function pgBinDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AGENT_OFFICE_LIVE_PG_BIN) return env.AGENT_OFFICE_LIVE_PG_BIN;
  // Looked up once per PATH: every psql call and every instance start asked, each a PATH scan and a folder read on the event loop.
  const key = `${env.PATH ?? env.Path ?? ''}|${env.ProgramFiles ?? ''}`;
  if (env === process.env && pgBin?.key === key) return pgBin.dir;
  const dir = findPgBin(env);
  if (env === process.env) pgBin = { key, dir };
  return dir;
}

function findPgBin(env: NodeJS.ProcessEnv): string | undefined {
  if (resolveCommand('psql')) return undefined;
  if (!WIN) return process.platform === 'darwin' ? macPgBinDir() : undefined;
  const root = path.join(env.ProgramFiles || 'C:\\Program Files', 'PostgreSQL');
  try {
    const versions = readdirSync(root)
      .filter((v) => existsSync(path.join(root, v, 'bin', 'psql.exe')))
      .sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a));
    return versions[0] && path.join(root, versions[0], 'bin');
  } catch {
    return undefined;
  }
}

/** Starts `cmd args` in `cwd`, in a process group of its own off POSIX so the group can be stopped together. */
export function startTree(cmd: string, args: string[], cwd: string, extraEnv: Record<string, string>, pathAdd?: string): ChildProcess {
  const env = { ...childEnv(), ...extraEnv };
  if (pathAdd) {
    const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
    env[key] = `${env[key] ?? ''}${path.delimiter}${pathAdd}`;
  }
  return spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: !WIN, windowsHide: true });
}

/** Stops `child` and everything it started; resolves once it has exited (or `waitMs` went by). */
export function stopTree(child: ChildProcess, waitMs = 15_000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return resolve();
    const timer = setTimeout(resolve, waitMs);
    // Done when the root has exited and taskkill has finished with the whole tree: the root can exit first,
    // and a caller that moved on then could leave the runtime's children holding ports and pipes.
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    // Not killTreeNow: a synchronous taskkill held the event loop for a second or more per stop on Windows
    // (one of the server's 1-7 s stalls while instances and live apps stopped).
    void Promise.all([exited, killTreeAsync(child.pid)]).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Ends a process tree without holding the event loop (taskkill runs as a child of its own off POSIX's group kill); resolves when that's done. */
export function killTreeAsync(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (!WIN) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // Gone already.
      }
      return resolve();
    }
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: 30_000 }, () => resolve());
  });
}

/** Ends a process tree at once, synchronously: only for when the office's own process exits (it blocks the event loop meanwhile). */
export function killTreeNow(pid: number) {
  try {
    if (WIN) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // Gone already.
  }
}
