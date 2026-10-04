// Running mxcli and ending it again. `mxcli run --local` starts mxbuild and a Java runtime under
// it, so stopping it means stopping the whole tree, or the ports stay taken; and it asks psql to
// make the app's database when that's missing, so PostgreSQL's bin folder goes on its PATH.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from '../workers/env.js';
import { resolveCommand } from '../workers/process.js';

const WIN = process.platform === 'win32';

/**
 * The folder psql is in, when it isn't on PATH already: AGENT_OFFICE_LIVE_PG_BIN, or the newest
 * PostgreSQL the Windows installer put under Program Files. Undefined when there's nothing to add.
 */
export function pgBinDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.AGENT_OFFICE_LIVE_PG_BIN) return env.AGENT_OFFICE_LIVE_PG_BIN;
  if (resolveCommand('psql') || !WIN) return undefined;
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
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    killTreeNow(child.pid);
  });
}

/** Ends a process tree at once, synchronously: also what runs as the office's own process exits. */
export function killTreeNow(pid: number) {
  try {
    if (WIN) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    // Gone already.
  }
}
