// Running the setup's commands (git, gh, the toolkit's bash scripts) so the wizard can show what they
// say as they say it. Every one runs with stdin closed and a time limit: the toolkit's pre-commit hook
// used to wait forever for input under `git commit` on Windows, and a setup step that hangs is worse
// than one that fails, because a failed one can be retried.

import { spawn } from 'node:child_process';
import { spawnOff, type OffChild } from '../offloop/exec.js';

export interface RunOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  /** Hears each line of output (stdout and stderr) as it comes. */
  onLine?: (line: string) => void;
  /** A non-zero exit resolves instead of throwing. */
  allowFail?: boolean;
}

export interface RunResult {
  code: number | null;
  /** The last of what it said, for an error message. */
  tail: string[];
  stdout: string;
}

const TAIL = 12;

/** Kills a command and everything it started (bash runs a tree of them). */
function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

export function runCommand(cmd: string, args: string[], opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    let child: OffChild;
    try {
      // Started off the event loop (offloop/exec.ts): starting a program can take seconds on Windows.
      child = spawnOff(cmd, args, { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv | undefined, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (err) {
      reject(new Error(`Couldn't run ${cmd}: ${(err as Error).message}`));
      return;
    }
    const tail: string[] = [];
    let stdout = '';
    const partial = { out: '', err: '' };
    const take = (which: 'out' | 'err', chunk: string) => {
      const text = partial[which] + chunk;
      if (which === 'out' && stdout.length < 1_000_000) stdout += chunk;
      const parts = text.split(/\r\n|\n|\r/);
      partial[which] = parts.pop() ?? '';
      for (const line of parts) said(line);
    };
    const said = (line: string) => {
      if (!line.trim()) return;
      tail.push(line);
      if (tail.length > TAIL) tail.shift();
      opts.onLine?.(line);
    };
    child.on('stdout', (c: string) => take('out', c));
    child.on('stderr', (c: string) => take('err', c));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, opts.timeoutMs);
    child.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === 'ENOENT' ? `${cmd} isn't installed on the office's machine (or isn't on its PATH)` : `Couldn't run ${cmd}: ${err.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      said(partial.out);
      said(partial.err);
      if (timedOut) return reject(new Error(`${cmd} ${args[0] ?? ''} took longer than ${Math.round(opts.timeoutMs / 1000)}s and was stopped`));
      if (code !== 0 && !opts.allowFail) return reject(new Error(`${cmd} ${args[0] ?? ''} failed (exit ${code}): ${tail.slice(-3).join(' ').slice(0, 400) || 'no output'}`));
      resolve({ code, tail, stdout });
    });
  });
}

/** A Windows path as Git Bash spells it (C:\a\b → /c/a/b); other paths as they are. */
export function bashPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  return m ? `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : p.replace(/\\/g, '/');
}
